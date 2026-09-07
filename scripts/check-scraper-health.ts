// scripts/check-scraper-health.ts
// Alerting de salud del scraping. Consulta dos señales y sale con código ≠0 si
// alguna cruza umbral — corrible en CI/cron para detectar problemas temprano:
//
//   1. Tasa de bloqueo: % de intentos rechazados por portal en las últimas N
//      horas. Umbral por defecto: >20% → el portal nos está cerrando la puerta.
//      Cuenta 401/403/407/429: el 26-ago-2026 Properati pasó a responder 401 a
//      todo y, como sólo mirábamos 403/429, el reporte decía "0/8093 bloqueados
//      (0.0%)" mientras el portal llevaba 6 días sin entrar una sola fila.
//   2. Cursor staleness: hace cuánto corrió el último tick de cada portal.
//      Umbral por defecto: >3h sin correr → el orquestador puede estar caído.
//
// Uso: npm run check:scrapers   (o: tsx scripts/check-scraper-health.ts)
// Lee de scrape_attempts (migración 016) y scraper_cursor (migración 013).

import { writeFileSync } from 'node:fs';
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { normalizeSupabaseUrl } from '../lib/supabase-url';
config({ path: '.env.local' });

const LOOKBACK_HOURS = 6;
const BLOCK_RATE_THRESHOLD = 0.2; // 20% de respuestas de bloqueo
// Códigos que significan "el portal no nos deja entrar", no "esta URL no está".
// 404 queda fuera a propósito: un listing borrado es ruido normal del sitemap.
const BLOCK_STATUS_CODES = [401, 403, 407, 429];
const MIN_ATTEMPTS_FOR_RATE = 20; // no alertar con muestra chica
const STALE_HOURS = 3;

interface CursorRow {
  portal: string;
  last_run_at: string | null;
  last_run_status: string | null;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('❌ Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
    process.exit(2);
  }
  // Normalizado: el secret de GitHub traía sufijo '/rest/v1/' y todas las
  // lecturas fallaban con PGRST125. Ver lib/supabase-url.ts.
  const sb = createClient(normalizeSupabaseUrl(url), key, {
    auth: { persistSession: false },
  });

  const problems: string[] = [];

  // ── 1. Tasa de bloqueo (403/429) por portal ──────────────────────────────
  // Usamos count exacto por portal en vez de traer las filas: Supabase tiene
  // max-rows=1000 por defecto, así que un select de todas las filas se trunca
  // silenciosamente y oculta los portales con menos volumen (ej. properati
  // queda fuera del top-1000 que dominan fincaraiz/ciencuadras). Los counts
  // server-side no tienen ese límite.
  const since = new Date(Date.now() - LOOKBACK_HOURS * 3_600_000).toISOString();

  // Lista de portales a auditar: los configurados en scraper_cursor. Robusto
  // ante portales nuevos sin tener que hardcodear.
  const { data: portalRows, error: portalErr } = await sb
    .from('scraper_cursor')
    .select('portal')
    .order('portal');

  if (portalErr) {
    // NO es un warning: si no podemos leer, no sabemos nada de la salud de los
    // scrapers. Reportarlo como "sin alertas" fue lo que ocultó durante
    // semanas que el cron escribía 0 filas (incidente PGRST125, 2026-08-18).
    problems.push(`no pude leer scraper_cursor: ${portalErr.message}`);
  } else {
    const portals = (portalRows ?? []).map((r) => (r as { portal: string }).portal);
    console.log(`\n━━ Tasa de bloqueo (últimas ${LOOKBACK_HOURS}h) ━━`);
    if (portals.length === 0) {
      console.log('  (sin portales configurados)');
    }
    for (const portal of portals) {
      const { count: total, error: totalErr } = await sb
        .from('scrape_attempts')
        .select('*', { count: 'exact', head: true })
        .eq('portal', portal)
        .gte('created_at', since);
      if (totalErr) {
        problems.push(`${portal}: no pude contar attempts: ${totalErr.message}`);
        continue;
      }
      // Desglose por código en vez de un solo count: 401 (auth nueva), 403
      // (WAF), 429 (rate limit) piden respuestas distintas, y saberlo en la
      // alerta ahorra ir a bucear los logs del runner.
      const byCode: Array<[number, number]> = [];
      let b = 0;
      let countErr: string | null = null;
      for (const code of BLOCK_STATUS_CODES) {
        const { count, error } = await sb
          .from('scrape_attempts')
          .select('*', { count: 'exact', head: true })
          .eq('portal', portal)
          .gte('created_at', since)
          .eq('status_code', code);
        // Un count fallido NO puede leerse como cero: esa coerción silenciosa
        // es exactamente la que pinta de verde un portal caído.
        if (error || count == null) {
          countErr = error?.message ?? 'count was null';
          break;
        }
        if (count > 0) byCode.push([code, count]);
        b += count;
      }
      if (countErr) {
        problems.push(`${portal}: no pude contar bloqueos: ${countErr}`);
        console.log(`  ⚠️  ${portal}: conteo de bloqueos falló (${countErr})`);
        continue;
      }

      const t = total ?? 0;
      const rate = t > 0 ? b / t : 0;
      const pct = (rate * 100).toFixed(1);
      const flagged = t >= MIN_ATTEMPTS_FOR_RATE && rate > BLOCK_RATE_THRESHOLD;
      const flag = flagged ? '🔴' : '✅';
      const detail = byCode.length ? ` [${byCode.map(([c, n]) => `${c}×${n}`).join(' ')}]` : '';
      console.log(`  ${flag} ${portal}: ${b}/${t} bloqueados (${pct}%)${detail}`);
      if (flagged) {
        problems.push(
          `${portal}: tasa de bloqueo ${pct}% (>${BLOCK_RATE_THRESHOLD * 100}%) en ${t} intentos${detail}`
        );
      }
    }
  }

  // ── 2. Cursor staleness ───────────────────────────────────────────────────
  const { data: cursors, error: curErr } = await sb
    .from('scraper_cursor')
    .select('portal, last_run_at, last_run_status')
    .order('portal');

  if (curErr) {
    problems.push(`no pude leer cursores: ${curErr.message}`);
  } else {
    console.log(`\n━━ Cursor staleness (umbral ${STALE_HOURS}h) ━━`);
    const now = Date.now();
    for (const c of (cursors ?? []) as CursorRow[]) {
      if (!c.last_run_at) {
        console.log(`  ⚠️  ${c.portal}: nunca corrió`);
        problems.push(`${c.portal}: cursor sin last_run_at (nunca corrió)`);
        continue;
      }
      const ageH = (now - new Date(c.last_run_at).getTime()) / 3_600_000;
      const flag = ageH > STALE_HOURS ? '🔴' : '✅';
      console.log(
        `  ${flag} ${c.portal}: hace ${ageH.toFixed(1)}h (status: ${c.last_run_status ?? '—'})`
      );
      if (ageH > STALE_HOURS) {
        problems.push(`${c.portal}: último tick hace ${ageH.toFixed(1)}h (>${STALE_HOURS}h)`);
      }
    }
  }

  // ── Veredicto ─────────────────────────────────────────────────────────────
  // HEALTH_REPORT_PATH: el workflow lo setea para convertir estos problemas en
  // un issue de GitHub. Se escribe SIEMPRE (vacío cuando todo está sano), para
  // que el paso de alerta distinga "sano" de "el chequeo ni siquiera corrió" —
  // ausencia de archivo significa que este script se cayó antes de concluir.
  const reportPath = process.env.HEALTH_REPORT_PATH;
  if (reportPath) {
    writeFileSync(reportPath, problems.map((p) => `- ${p}`).join('\n'), 'utf8');
  }

  console.log('\n' + '='.repeat(60));
  if (problems.length > 0) {
    console.error(`❌ ${problems.length} problema(s) de salud detectado(s):`);
    for (const p of problems) console.error(`   - ${p}`);
    process.exit(1);
  }
  console.log('✅ Scrapers saludables — sin alertas.');
}

main().catch((err) => {
  console.error('Error inesperado:', err);
  process.exit(2);
});
