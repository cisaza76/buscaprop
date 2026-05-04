// lib/scrapers/metrocuadrado.ts
// Scraper de MetroCuadrado — sin sitemap público; descubre URLs paginando
// search results, luego extrae datos del payload Next.js RSC.
// Estado: STUB para Día 3.
//
// Recon Día 1:
// - robots.txt: User-agent: * permite listings (solo bloquea /admin, /web, etc)
// - NO hay sitemap.xml (devuelve la SPA Next.js)
// - Search URL: https://www.metrocuadrado.com/{tipo}/{operacion}/{ciudad}/
//   ej: /apartamento/venta/bogota/  (~3.000+ listings paginados)
// - Detalle URL pattern (extraído del HTML del search):
//   /inmueble/{operacion-tipo-ciudad-barrio-habs-banos-garajes}/{numeric}-M{id}
// - HTML del search: 414KB, listings URLs HARDCODED en el HTML SSR (128 por página)
// - HTML del detalle: 41KB, NO tiene JSON-LD; los datos están en
//   `self.__next_f.push([1, "..."])` chunks (RSC streaming format)
// - Campos visibles en RSC: bathrooms, area, neighborhood, images
// - Tool: Cheerio + parser custom de RSC payload (más laborioso pero viable
//         sin Playwright). Si Día 3 esto rompe, fallback a Playwright.

import type { ScrapeResult, ScrapedProperty } from './shared/types';

export interface MetroCuadradoOptions {
  maxListings?: number;
  cities?: string[]; // slugs: bogota, medellin, cali, etc
  propertyTypes?: Array<'apartamento' | 'casa' | 'oficina' | 'lote'>;
  listingTypes?: Array<'venta' | 'arriendo'>;
}

export async function scrapeMetroCuadrado(_opts: MetroCuadradoOptions = {}): Promise<ScrapeResult> {
  const startedAt = new Date().toISOString();
  // TODO Día 3:
  //   1. para cada combo {city × type × listing}: fetchText search page
  //   2. cheerio → extraer href="/inmueble/...{ID}-M{NUM}"
  //   3. paginar (?page=N) hasta 0 nuevas URLs
  //   4. para cada URL detalle: fetchText → extraer chunks RSC
  //   5. parsear JSON dentro de los chunks → ScrapedProperty
  //   6. upsertBatch
  throw new Error('scrapeMetroCuadrado not implemented yet (Día 3)');

  // eslint-disable-next-line @typescript-eslint/no-unreachable
  return {
    portal: 'metrocuadrado',
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

// Decodifica los chunks self.__next_f.push([1, "..."]) de una página detalle.
// Por implementar Día 3.
export function extractRscPayload(_html: string): string {
  // TODO: regex /self\.__next_f\.push\(\[1,\s*"((?:\\.|[^"\\])*)"\]\)/g
  // → unescape \", \\n → concatenar → buscar JSON con keys conocidas
  return '';
}
