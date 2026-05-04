// lib/scrapers/fincaraiz.ts
// Scraper de Fincaraíz — usa sitemap-index → child sitemaps → detail pages.
// Estado: STUB para Día 2 (lógica completa por implementar).
//
// Recon Día 1:
// - robots.txt: 3500+ "bad bots" bloqueados, pero `User-agent: *` permite listings
// - Sitemap principal: https://www.fincaraiz.com.co/cde-sitemap-listings-index.xml
// - Naming: cde-sitemap-listings-{tipo}-en-{operacion}-{departamento}.xml
//   ej: apartamento-en-venta-bogota-dc.xml (≈18.700 listings)
// - URL detalle: /{slug}/{numeric_id}  (puede redirigir a /proyectos-vivienda/...)
// - HTML detalle: tiene <script type="application/ld+json"> @type RentAction|SaleAction
//   con priceSpecification, name, url, image, description
// - Tool: Cheerio (HTML estático, sin JS requerido)

import type { ScrapeResult, ScrapedProperty } from './shared/types';

export interface FincaraizOptions {
  // Cuántos listings procesar como máximo en una corrida.
  maxListings?: number;
  // Departamentos a procesar (default: bogota-dc + antioquia + valle-del-cauca + atlantico + bolivar).
  departments?: string[];
  // Tipos a procesar.
  propertyTypes?: Array<'apartamento' | 'casa' | 'apartaestudio' | 'oficina' | 'lote'>;
  // Operaciones a procesar.
  listingTypes?: Array<'venta' | 'alquiler'>;
}

export const FINCARAIZ_SITEMAP_INDEX =
  'https://www.fincaraiz.com.co/cde-sitemap-listings-index.xml';

export async function scrapeFincaraiz(_opts: FincaraizOptions = {}): Promise<ScrapeResult> {
  const startedAt = new Date().toISOString();
  // TODO Día 2:
  //   1. fetchXml(FINCARAIZ_SITEMAP_INDEX) → parse <sitemap><loc>
  //   2. filtrar child sitemaps por opts.departments × propertyTypes × listingTypes
  //   3. para cada child: fetchXml → parse <url><loc> + <lastmod>
  //   4. para cada listing URL: fetchText → cheerio → extraer JSON-LD
  //   5. mapear a ScrapedProperty → upsertBatch
  throw new Error('scrapeFincaraiz not implemented yet (Día 2)');

  // eslint-disable-next-line @typescript-eslint/no-unreachable -- TS happy con el shape
  return {
    portal: 'fincaraiz',
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

// Helper para parsear una página detalle. Por implementar Día 2.
export async function parseFincaraizListing(_url: string, _html: string): Promise<ScrapedProperty | null> {
  // TODO: usar cheerio + extraer JSON-LD `<script type="application/ld+json">`
  return null;
}
