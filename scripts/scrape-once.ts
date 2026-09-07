// scripts/scrape-once.ts
// CLI para ejecutar los scrapers manualmente desde la terminal.
// Uso:
//   npx tsx scripts/scrape-once.ts [--portal fincaraiz] [--max 50] [--op venta|arriendo]
//   npx tsx scripts/scrape-once.ts --refresh-contacts [--portal X]
//
// Útil para:
//   - smoke testing de un scraper específico
//   - poblar la BD localmente sin esperar al cron
//   - refrescar contact_phone/name/company en listings existentes
//
// Notas:
// - --op acepta 'venta' o 'arriendo'. Para Fincaraíz se mapea 'arriendo' → 'alquiler'.
// - Sin --op, cada scraper usa su default (típicamente venta+arriendo).
// - --refresh-contacts re-corre el scraper con --max 5000 default. Como
//   upsert es idempotente, los listings existentes se ACTUALIZAN con los
//   nuevos campos contact_name/phone/company sin duplicar filas.
//   Para refrescar UN portal específico: --refresh-contacts --portal Y.

// Cargar .env.local antes de cualquier import que dependa de env vars.
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { runAllScrapers, type RunnerOptions } from '../lib/scrapers/runner';
import { dominantError, failedRuns } from '../lib/scrapers/shared/run-outcome';
import type { SourcePortal } from '../lib/scrapers/shared/types';

type Op = 'venta' | 'arriendo';

interface CliArgs {
  portal?: SourcePortal;
  max?: number;
  op?: Op;
  refreshContacts?: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--portal') args.portal = argv[++i] as SourcePortal;
    else if (a === '--max') args.max = parseInt(argv[++i], 10);
    else if (a === '--op') args.op = argv[++i] as Op;
    else if (a === '--refresh-contacts') args.refreshContacts = true;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const portals = args.portal ? [args.portal] : undefined;

  // Mapear --op a las listingTypes específicas de cada portal.
  // Si no se especifica --op, dejar undefined → cada scraper usa su default.
  const fincaraizOps: Array<'venta' | 'alquiler'> | undefined =
    args.op === 'venta' ? ['venta'] : args.op === 'arriendo' ? ['alquiler'] : undefined;
  const otherOps: Op[] | undefined = args.op ? [args.op] : undefined;

  // --refresh-contacts: si no se especifica --max, defaultear a 5000 para
  // cubrir todo el inventario realista. La upsert idempotente actualiza
  // contact_name/phone/company en listings existentes.
  let max = args.max;
  if (args.refreshContacts && !max) {
    max = 5000;
    console.log('🔄 Refresh-contacts mode: --max default 5000 (override con --max N).');
    console.log('   Disponibilidad de phone por portal:');
    console.log('     ✓ MetroCuadrado: phone+whatsapp inline en search (rápido)');
    console.log('     ~ Fincaraíz:     name del landlord (phone solo si está en HTML)');
    console.log('     ~ Properati:     name de la agencia (phone tras click, no scrapeable)');
    console.log('     ✗ Ciencuadras:   contacto detrás de form JS (no accesible)');
  }

  console.log('🚀 Iniciando scrapers...', {
    portals: portals ?? 'todos',
    max,
    op: args.op ?? 'venta+arriendo',
    refreshContacts: !!args.refreshContacts,
  });

  const opts: RunnerOptions = {
    portals,
    fincaraiz: { maxListings: max, listingTypes: fincaraizOps },
    metrocuadrado: { maxListings: max, listingTypes: otherOps },
    properati: { maxListings: max, listingTypes: otherOps },
    ciencuadras: { maxListings: max, listingTypes: otherOps },
  };

  const { results, totals } = await runAllScrapers(opts);

  for (const r of results) {
    console.log(`\n📊 ${r.portal}`);
    console.log(`   discovered: ${r.discovered}, fetched: ${r.fetched}, parsed: ${r.parsed}`);
    console.log(`   upserted: ${r.upserted}, duplicates: ${r.duplicates}`);
    if (r.errors.length) {
      console.log(`   ❌ errors: ${r.errors.length} (primeros 3:)`);
      for (const e of r.errors.slice(0, 3)) {
        console.log(`      ${e.stage}: ${e.url} — ${e.message}`);
      }
    }
  }

  console.log('\n========================================');
  console.log(
    `Totales: ${totals.upserted} upserted, ${totals.duplicates} duplicates, ${totals.errors} errors en ${(
      totals.durationMs / 1000
    ).toFixed(1)}s`
  );

  // Salir con ≠0 cuando un portal no escribió nada: sin esto el job de CI sale
  // verde igual y el fallo pasa inadvertido. Ver lib/scrapers/shared/run-outcome.
  const failed = failedRuns(results);
  if (failed.length) {
    console.error('\n❌ Portales sin escribir una sola fila:');
    for (const r of failed) {
      console.error(
        `   ${r.portal}: 0 upserted, ${r.errors.length} errores — ${dominantError(r.errors)}`
      );
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('❌ Fatal:', err);
  process.exit(1);
});
