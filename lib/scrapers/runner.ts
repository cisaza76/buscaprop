// lib/scrapers/runner.ts
// Orquestador que ejecuta los 4 scrapers en serie y reporta totales.
// Pensado para correr desde:
//   - app/api/cron/scrape/route.ts (vía GitHub Actions / Vercel Cron)
//   - scripts/scrape-once.ts (CLI local)

import { scrapeFincaraiz, type FincaraizOptions } from './fincaraiz';
import { scrapeMetroCuadrado, type MetroCuadradoOptions } from './metrocuadrado';
import { scrapeProperati, type ProperatiOptions } from './properati';
import { scrapeCiencuadras, type CiencuadrasOptions } from './ciencuadras';
import type { ScrapeResult, SourcePortal } from './shared/types';

export interface RunnerOptions {
  portals?: SourcePortal[];
  fincaraiz?: FincaraizOptions;
  metrocuadrado?: MetroCuadradoOptions;
  properati?: ProperatiOptions;
  ciencuadras?: CiencuadrasOptions;
}

const ALL_PORTALS: SourcePortal[] = [
  'fincaraiz',
  'ciencuadras',
  'properati',
  'metrocuadrado',
]; // orden por dificultad ascendente — los fáciles primero para tener data temprano si rompe.

export async function runAllScrapers(opts: RunnerOptions = {}): Promise<{
  results: ScrapeResult[];
  totals: {
    upserted: number;
    duplicates: number;
    errors: number;
    durationMs: number;
  };
}> {
  const portals = opts.portals ?? ALL_PORTALS;
  const results: ScrapeResult[] = [];
  const startedAt = Date.now();

  for (const portal of portals) {
    try {
      const r = await runOne(portal, opts);
      results.push(r);
    } catch (err) {
      results.push({
        portal,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 0,
        discovered: 0,
        fetched: 0,
        parsed: 0,
        upserted: 0,
        duplicates: 0,
        errors: [
          {
            url: '<runner>',
            stage: 'discovery',
            message: err instanceof Error ? err.message : String(err),
          },
        ],
      });
    }
  }

  const totals = results.reduce(
    (acc, r) => ({
      upserted: acc.upserted + r.upserted,
      duplicates: acc.duplicates + r.duplicates,
      errors: acc.errors + r.errors.length,
      durationMs: acc.durationMs + r.durationMs,
    }),
    { upserted: 0, duplicates: 0, errors: 0, durationMs: Date.now() - startedAt }
  );

  return { results, totals };
}

async function runOne(portal: SourcePortal, opts: RunnerOptions): Promise<ScrapeResult> {
  switch (portal) {
    case 'fincaraiz':
      return scrapeFincaraiz(opts.fincaraiz);
    case 'ciencuadras':
      return scrapeCiencuadras(opts.ciencuadras);
    case 'properati':
      return scrapeProperati(opts.properati);
    case 'metrocuadrado':
      return scrapeMetroCuadrado(opts.metrocuadrado);
  }
}
