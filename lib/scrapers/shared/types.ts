// lib/scrapers/shared/types.ts
// Tipos compartidos entre scrapers. La forma final coincide con la tabla
// `properties` del schema (ver supabase/migrations/001_buscaprop_schema.sql).

export type SourcePortal = 'fincaraiz' | 'metrocuadrado' | 'properati' | 'ciencuadras';
export type PropertyType = 'apartamento' | 'casa' | 'oficina' | 'lote';
export type ListingType = 'venta' | 'arriendo';

// Lo que produce cada scraper antes de upsert. `source_portal` y `source_url`
// son la clave única natural — todo lo demás es opcional para tolerar
// portales que no expongan algunos campos.
export interface ScrapedProperty {
  source_portal: SourcePortal;
  source_url: string;
  title: string;
  description?: string;
  price_cop: number;
  city: string;
  neighborhood?: string;
  bedrooms?: number;
  bathrooms?: number;
  area_m2?: number;
  property_type: PropertyType;
  listing_type: ListingType;
  photos: string[];
  latitude?: number;
  longitude?: number;
  /** Persona o agente que publicó (puede ser nombre individual o empresa). */
  contact_name?: string;
  /** Teléfono/WhatsApp del agente (formato E.164 sin '+', listo para wa.me/). */
  contact_phone?: string;
  /** Nombre de la empresa/agencia (ej: "Profesionales Inmobiliarios"). */
  company_name?: string;
  scraped_at?: string; // ISO timestamp; default = ahora.
}

// Resultado agregado de una corrida de scraper.
export interface ScrapeResult {
  portal: SourcePortal;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  discovered: number; // cuántas URLs encontramos en sitemaps/listings
  fetched: number; // cuántas páginas detalle bajamos
  parsed: number; // parseos exitosos
  upserted: number; // filas insertadas o actualizadas
  duplicates: number; // marcadas is_duplicate=true contra otro portal
  errors: ScrapeError[];
  /** Posición next del cursor (chunked scraping). 0 = completó full ciclo. */
  nextCursor?: ScraperCursorState;
}

// Estado del cursor de scraping incremental por portal.
// - sitemap-based (Fincaraíz, Ciencuadras): {sitemap_idx, url_idx}
// - combo-based (MetroCuadrado): {combo_idx}
// - search-based (Properati): {sitemap_idx} usado como page offset
export interface ScraperCursorState {
  last_sitemap_idx?: number;
  last_url_idx?: number;
  last_combo_idx?: number;
}

export interface ScrapeError {
  url: string;
  stage: 'discovery' | 'fetch' | 'parse' | 'upsert';
  message: string;
}
