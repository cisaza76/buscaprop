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

interface AttemptRow {
  portal: string | null;
  status_code: number | null;
}

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
  const since = new Date(Date.now() - LOOKBACK_HOURS * 3_600_000).toISOString();
  const { data: attempts, error: attErr } = await sb
    .from('scrape_attempts')
    .select('portal, status_code')
    .gte('created_at', since)
    .limit(100_000);

  if (attErr) {
    console.warn(`⚠️  No pude leer scrape_attempts (${attErr.message}). ¿Migración 016 aplicada?`);
  } else {
    const byPortal = new Map<string, { total: number; blocked: number }>();
    for (const a of (attempts ?? []) as AttemptRow[]) {
      const p = a.portal ?? 'unknown';
      const agg = byPortal.get(p) ?? { total: 0, blocked: 0 };
      agg.total++;
      if (a.status_code === 403 || a.status_code === 429) agg.blocked++;
      byPortal.set(p, agg);
    }
    console.log(`\n━━ Tasa de bloqueo (últimas ${LOOKBACK_HOURS}h) ━━`);
    if (byPortal.size === 0) {
      console.log('  (sin intentos registrados en la ventana)');
    }
    for (const [portal, { total, blocked }] of byPortal) {
      const rate = total > 0 ? blocked / total : 0;
      const pct = (rate * 100).toFixed(1);
      const flag =
        total >= MIN_ATTEMPTS_FOR_RATE && rate > BLOCK_RATE_THRESHOLD ? '🔴' : '✅';
      console.log(`  ${flag} ${portal}: ${blocked}/${total} bloqueados (${pct}%)`);
      if (total >= MIN_ATTEMPTS_FOR_RATE && rate > BLOCK_RATE_THRESHOLD) {
        problems.push(
          `${portal}: tasa de bloqueo ${pct}% (>${BLOCK_RATE_THRESHOLD * 100}%) en ${total} intentos`
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
