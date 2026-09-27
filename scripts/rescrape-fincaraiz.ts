// scripts/rescrape-fincaraiz.ts
// Re-lee fichas de Fincaraiz que se parsearon con el parser roto y las
// re-escribe con el arreglado.
//
// Contexto (2026-09-27): hacia el 20-ago Fincaraiz cambió su JSON-LD a
// RealEstateListing. El parser no lo reconocía, caía al regex "primer $ del
// HTML" y guardaba cifras de la descripción. ~75.600 filas afectadas. Su
// huella: latitude NULL (las coordenadas también dejaron de leerse), así que
// el criterio de selección es `latitude is null` y `scraped_at` desde el
// 15-ago y anterior al arranque de la corrida — lo que ya se re-leyó queda
// con scraped_at nuevo y no vuelve a salir. Idempotente y reanudable.
//
// Uso:
//   npx tsx scripts/rescrape-fincaraiz.ts --max 500               # lote chico
//   npx tsx scripts/rescrape-fincaraiz.ts --max 2000 --anomalies  # primero lo absurdo
//   npx tsx scripts/rescrape-fincaraiz.ts --dry-run --max 20      # no escribe
//
// Prudencia anti-ban (ver memoria "scraper scaling — risk-first"): misma
// cadencia que el cron (1,5s/request vía fetchText), telemetría en
// scrape_attempts, y aborta ante 3 respuestas de bloqueo seguidas.

import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });

const SINCE = '2026-08-15T00:00:00Z';
const PAGE = 500;
const MAX_CONSECUTIVE_BLOCKS = 3;

interface Row {
  id: string;
  source_url: string;
  scraped_at: string;
}

function parseArgs(argv: string[]) {
  const a = { max: 500, anomalies: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--max') a.max = parseInt(argv[++i], 10);
    else if (argv[i] === '--anomalies') a.anomalies = true;
    else if (argv[i] === '--dry-run') a.dryRun = true;
  }
  if (!Number.isFinite(a.max) || a.max < 1) throw new Error('--max debe ser un entero positivo');
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { createClient } = await import('@supabase/supabase-js');
  const { fetchText, HttpError } = await import('../lib/scrapers/shared/http');
  const { parseFincaraizListing } = await import('../lib/scrapers/fincaraiz');
  const { upsertProperty } = await import('../lib/scrapers/shared/upsert');
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
  const runStart = new Date().toISOString();

  // Filtros de "absurdo" — los mismos de la auditoría del 2026-09-27.
  const ANOMALY_OR = [
    'and(listing_type.eq.venta,price_cop.lt.30000000)',
    'and(listing_type.eq.venta,price_cop.gt.50000000000)',
    'and(listing_type.eq.arriendo,price_cop.lt.300000)',
    'and(listing_type.eq.arriendo,price_cop.gt.80000000)',
    'area_m2.lte.10',
    'bedrooms.gt.12',
  ].join(',');

  // Keyset por scraped_at: el cursor avanza sobre filas que esta corrida NO
  // modifica (las procesadas saltan a scraped_at >= runStart).
  async function nextPage(after: string): Promise<Row[]> {
    for (let attempt = 1; ; attempt++) {
      let q = sb
        .from('properties')
        .select('id, source_url, scraped_at')
        .eq('source_portal', 'fincaraiz')
        .is('latitude', null)
        .gt('scraped_at', after)
        .lt('scraped_at', runStart)
        .order('scraped_at')
        .limit(PAGE);
      if (args.anomalies) q = q.or(ANOMALY_OR);
      const { data, error } = await q;
      if (!error) return (data ?? []) as Row[];
      if (attempt >= 4) throw new Error(`leer candidatas: ${error.message}`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }

  const stats = { fetched: 0, updated: 0, delisted: 0, noPrice: 0, errors: 0 };
  let consecutiveBlocks = 0;
  let cursor = SINCE;
  let done = 0;

  console.log(
    `${args.dryRun ? '🔍 DRY RUN' : '✍️  APPLY'} — max ${args.max}${args.anomalies ? ', solo anomalías' : ''}`
  );

  outer: while (done < args.max) {
    const rows = await nextPage(cursor);
    if (!rows.length) break;
    for (const row of rows) {
      if (done >= args.max) break outer;
      cursor = row.scraped_at;
      done++;

      let html: string;
      try {
        html = await fetchText(row.source_url, {
          portal: 'fincaraiz',
          maxRetries: 1,
          blockWaitMs: 30_000,
        });
        stats.fetched++;
        consecutiveBlocks = 0;
      } catch (err) {
        const status = err instanceof HttpError ? err.status : null;
        if (status === 404 || status === 410) {
          // El portal ya no la publica: eso es exactamente is_active=false.
          stats.delisted++;
          if (!args.dryRun) {
            await sb.from('properties').update({ is_active: false }).eq('id', row.id);
          }
          continue;
        }
        stats.errors++;
        if (status === 401 || status === 403 || status === 407 || status === 429) {
          consecutiveBlocks++;
          if (consecutiveBlocks >= MAX_CONSECUTIVE_BLOCKS) {
            console.error(`🛑 ${consecutiveBlocks} bloqueos seguidos (HTTP ${status}) — abortando`);
            break outer;
          }
        }
        continue;
      }

      // Redirect a otra página (listing retirado → búsqueda): la ficha pedida
      // ya no existe. og:url sin el id numérico original lo delata.
      const id = row.source_url.match(/\/(\d+)\/?$/)?.[1];
      const ogUrl = html.match(/<meta[^>]+property="og:url"[^>]+content="([^"]+)"/)?.[1] ?? '';
      if (id && ogUrl && !ogUrl.includes(id)) {
        stats.delisted++;
        if (!args.dryRun) {
          await sb.from('properties').update({ is_active: false }).eq('id', row.id);
        }
        continue;
      }

      const item = parseFincaraizListing(row.source_url, html);
      if (!item) {
        // Sin precio estructurado ("precio a convenir"): no hay precio real
        // que guardar. Se deja la fila como está y se reporta el conteo.
        stats.noPrice++;
        continue;
      }
      // Actualizar EN SU FILA: el upsert es por (portal, source_url).
      item.source_url = row.source_url;
      if (!args.dryRun) await upsertProperty(item);
      stats.updated++;

      if (done % 100 === 0) console.log(`  … ${done} — ${JSON.stringify(stats)}`);
    }
  }

  console.log(`\nFin: ${done} procesadas — ${JSON.stringify(stats)}`);
  if (consecutiveBlocks >= MAX_CONSECUTIVE_BLOCKS) process.exit(1);
}

main().catch((err) => {
  console.error('❌', err.message ?? err);
  process.exit(1);
});
