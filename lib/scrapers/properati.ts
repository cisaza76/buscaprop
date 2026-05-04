// lib/scrapers/properati.ts
// Scraper de Properati — search pages SSR, sin sitemap directive en robots.
// Estado: STUB para Día 4.
//
// Recon Día 1:
// - robots.txt: bloquea nuestro UA "BuscaProp Colombia". Funciona con UA browser.
//   ⚠️  Hay que usar un UA browser-like (Chrome/Firefox) para los requests.
//   Idealmente sumar nuestro identificador en X-Identity header o similar.
// - Sin Sitemap: directive en robots.txt
// - Search URL: https://www.properati.com.co/s/{location-slug}/{type}/{operation}
//   ej: /s/bogota-d-c-colombia/apartamento/venta  (~8.575 listings)
// - HTML search: 926KB, plain SSR (sin Next.js streaming)
//   - Cards con `data-idanuncio="UUID"`
//   - Container `class="listings"`
// - Detalle URL: https://www.properati.com.co/detalle/{long-id}
// - Tool: Cheerio (HTML SSR limpio)

import type { ScrapeResult, ScrapedProperty } from './shared/types';

export interface ProperatiOptions {
  maxListings?: number;
  // Slugs Properati ej: 'bogota-d-c-colombia', 'medellin-antioquia'
  locations?: string[];
  propertyTypes?: Array<'apartamento' | 'casa' | 'apartaestudio' | 'oficina' | 'lote'>;
  listingTypes?: Array<'venta' | 'arriendo'>;
}

// UA tipo browser — Properati bloquea UAs no-browser.
export const PROPERATI_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 BuscaProp/1.0 (+contacto@buscaprop.co)';

export async function scrapeProperati(_opts: ProperatiOptions = {}): Promise<ScrapeResult> {
  const startedAt = new Date().toISOString();
  // TODO Día 4:
  //   1. para cada combo: fetchText search page (con PROPERATI_UA)
  //   2. cheerio → extraer href="/detalle/..." y data-idanuncio
  //   3. paginar
  //   4. fetchText detalle → cheerio → JSON-LD + selectores DOM
  //   5. upsertBatch
  throw new Error('scrapeProperati not implemented yet (Día 4)');

  // eslint-disable-next-line @typescript-eslint/no-unreachable
  return {
    portal: 'properati',
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: 0,
    discovered: 0,
    fetched: 0,
    parsed: 0,
    upserted: 0,
    duplicates: 0,
    errors: [],
  };
}
