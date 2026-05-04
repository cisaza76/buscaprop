// lib/scrapers/ciencuadras.ts
// Scraper de Ciencuadras — sitemap-index con sub-sitemaps por ciudad.
// Estado: STUB para Día 4 (junto con Properati).
//
// Recon Día 1:
// - robots.txt: User-agent: * permite todo excepto /wp-admin, /search, etc
//   Sitemap: https://www.ciencuadras.com/sitemap.xml
// - sitemap.xml → sitemap-index-detalles-inmuebles-{venta|arriendo}.xml
//   → sitemap-detalles-{op}-{ciudad}.xml (paginado: bogota.xml, bogota-2.xml, ...)
// - Solo Bogotá venta tiene 5 archivos × 2.500 = ~12.500 URLs
// - URL detalle: https://www.ciencuadras.com/inmueble/{tipo-en-{op}-en-{barrio}-{ciudad}-{numeric}}
//   ej: /inmueble/apartamento-en-venta-en-tuna-alta-bogota-3713891
// - HTML detalle: 291KB, NO tiene __NEXT_DATA__ (no es Next.js, plain SSR)
//   - JSON-LD: 4 bloques (Organization, WebSite, BreadcrumbList) — no tiene RealEstateListing 😞
//   - og:title incluye precio formateado: "Precio $ 208.000.000,00"
//   - og:description tiene specs: "Apartamento de 49 m² ... tres habitaciones"
//   - og:image, og:url disponibles
// - Tool: Cheerio (HTML SSR), parsing por DOM + meta tags + slug parsing

import type { ScrapeResult, ScrapedProperty } from './shared/types';

export interface CiencuadrasOptions {
  maxListings?: number;
  cities?: string[]; // slugs: 'bogota', 'medellin', etc
  listingTypes?: Array<'venta' | 'arriendo'>;
}

export const CIENCUADRAS_SITEMAP_INDEX = 'https://www.ciencuadras.com/sitemap.xml';

export async function scrapeCiencuadras(_opts: CiencuadrasOptions = {}): Promise<ScrapeResult> {
  const startedAt = new Date().toISOString();
  // TODO Día 4:
  //   1. fetchXml(CIENCUADRAS_SITEMAP_INDEX)
  //   2. para venta: bajar sitemap-index-detalles-inmuebles-venta.xml
  //   3. filtrar sub-sitemaps por opts.cities
  //   4. para cada sub-sitemap: parse <url><loc>
  //   5. fetchText detalle → cheerio → og: tags + DOM parsing
  //   6. el slug "/inmueble/casa-en-venta-en-suba-bogota-3091390" da
  //      type, operation, neighborhood, city, id de una sola
  //   7. upsertBatch
  throw new Error('scrapeCiencuadras not implemented yet (Día 4)');

  // eslint-disable-next-line @typescript-eslint/no-unreachable
  return {
    portal: 'ciencuadras',
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

// Parsea el slug de la URL para extraer type/op/neighborhood/city/id.
// Ej: "apartamento-en-venta-en-tuna-alta-bogota-3713891" →
//   { type:'apartamento', op:'venta', hood:'tuna alta', city:'bogota', id:'3713891' }
export function parseCiencuadrasSlug(_slug: string): null | {
  type: string;
  op: string;
  hood: string;
  city: string;
  id: string;
} {
  // TODO Día 4
  return null;
}
