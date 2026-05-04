// scripts/scrape-once.ts
// CLI para ejecutar los scrapers manualmente desde la terminal.
// Uso:
//   npx tsx scripts/scrape-once.ts [--portal fincaraiz] [--max 50] [--op venta|arriendo]
//
// Útil para:
//   - smoke testing de un scraper específico
//   - poblar la BD localmente sin esperar al cron
//   - debug en desarrollo
//
// Notas:
// - --op acepta 'venta' o 'arriendo'. Para Fincaraíz se mapea 'arriendo' → 'alquiler'
//   (que es el término que usa su sitemap).
// - Sin --op, cada scraper usa su default (típicamente venta+arriendo).

// Cargar .env.local antes de cualquier import que dependa de env vars.
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { runAllScrapers, type RunnerOptions } from '../lib/scrapers/runner';
import type { SourcePortal } from '../lib/scrapers/shared/types';

type Op = 'venta' | 'arriendo';

interface CliArgs {
  portal?: SourcePortal;
  max?: number;
  op?: Op;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--portal') args.portal = argv[++i] as SourcePortal;
    else if (a === '--max') args.max = parseInt(argv[++i], 10);
    else if (a === '--op') args.op = argv[++i] as Op;
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

  console.log('🚀 Iniciando scrapers...', {
    portals: portals ?? 'todos',
    max: args.max,
    op: args.op ?? 'venta+arriendo',
  });

  const opts: RunnerOptions = {
    portals,
    fincaraiz: { maxListings: args.max, listingTypes: fincaraizOps },
    metrocuadrado: { maxListings: args.max, listingTypes: otherOps },
    properati: { maxListings: args.max, listingTypes: otherOps },
    ciencuadras: { maxListings: args.max, listingTypes: otherOps },
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
}

main().catch((err) => {
  console.error('❌ Fatal:', err);
  process.exit(1);
});
