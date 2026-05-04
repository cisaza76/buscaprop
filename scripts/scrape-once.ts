// scripts/scrape-once.ts
// CLI para ejecutar los scrapers manualmente desde la terminal.
// Uso:
//   npx tsx scripts/scrape-once.ts [--portal fincaraiz] [--max 50]
//
// Útil para:
//   - smoke testing de un scraper específico
//   - poblar la BD localmente sin esperar al cron
//   - debug en desarrollo

// Cargar .env.local antes de cualquier import que dependa de env vars.
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { runAllScrapers } from '../lib/scrapers/runner';
import type { SourcePortal } from '../lib/scrapers/shared/types';

function parseArgs(argv: string[]): {
  portal?: SourcePortal;
  max?: number;
} {
  const args: { portal?: SourcePortal; max?: number } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--portal') args.portal = argv[++i] as SourcePortal;
    else if (a === '--max') args.max = parseInt(argv[++i], 10);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const portals = args.portal ? [args.portal] : undefined;

  console.log('🚀 Iniciando scrapers...', { portals: portals ?? 'todos', max: args.max });

  const { results, totals } = await runAllScrapers({
    portals,
    fincaraiz: { maxListings: args.max },
    metrocuadrado: { maxListings: args.max },
    properati: { maxListings: args.max },
    ciencuadras: { maxListings: args.max },
  });

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
