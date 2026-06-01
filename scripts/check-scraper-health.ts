// scripts/check-scraper-health.ts
// Alerting de salud del scraping. Consulta dos señales y sale con código ≠0 si
// alguna cruza umbral — corrible en CI/cron para detectar problemas temprano:
//
//   1. Tasa de bloqueo: % de intentos 403/429 por portal en las últimas N horas.
//      Umbral por defecto: >20% → un portal probablemente nos está baneando.
//   2. Cursor staleness: hace cuánto corrió el último tick de cada portal.
//      Umbral por defecto: >3h sin correr → el orquestador puede estar caído.
//
// Uso: npm run check:scrapers   (o: tsx scripts/check-scraper-health.ts)
// Lee de scrape_attempts (migración 016) y scraper_cursor (migración 013).

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
config({ path: '.env.local' });

const LOOKBACK_HOURS = 6;
const BLOCK_RATE_THRESHOLD = 0.2; // 20% de 403/429
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
  const sb = createClient(url, key, { auth: { persistSession: false } });

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
    console.warn(`⚠️  No pude leer scraper_cursor (${portalErr.message}).`);
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
        console.warn(`⚠️  ${portal}: no pude contar attempts (${totalErr.message}). ¿Migración 016 aplicada?`);
        continue;
      }
      const { count: blocked } = await sb
        .from('scrape_attempts')
        .select('*', { count: 'exact', head: true })
        .eq('portal', portal)
        .gte('created_at', since)
        .in('status_code', [403, 429]);

      const t = total ?? 0;
      const b = blocked ?? 0;
      const rate = t > 0 ? b / t : 0;
      const pct = (rate * 100).toFixed(1);
      const flagged = t >= MIN_ATTEMPTS_FOR_RATE && rate > BLOCK_RATE_THRESHOLD;
      const flag = flagged ? '🔴' : '✅';
      console.log(`  ${flag} ${portal}: ${b}/${t} bloqueados (${pct}%)`);
      if (flagged) {
        problems.push(
          `${portal}: tasa de bloqueo ${pct}% (>${BLOCK_RATE_THRESHOLD * 100}%) en ${t} intentos`
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
    console.warn(`⚠️  No pude leer scraper_cursor (${curErr.message}).`);
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
