// lib/scrapers/ciencuadras.ts
// Scraper de Ciencuadras — sitemap-index → detail pages → JSON-LD Product.
// Cada detail page tiene un Product JSON-LD con TODOS los campos clave
// (price, geo, area, beds, baths, type, address).
//
// Recon Día 4:
// - robots.txt allow listings, sitemap declarado
// - Discovery: sitemap.xml → sitemap-index-detalles-inmuebles-{op}.xml
//              → sitemap-detalles-{op}-{city}[-{N}].xml → URL list
// - URL pattern: /inmueble/{type}-en-{op}-en-{hood-slug}-{city}-{id}
// - Detail page (~290KB): JSON-LD @type=Product con offers.price,
//   offers.itemOffered (geo, floorSize, numberOfRooms, etc).

import * as cheerio from 'cheerio';
import { XMLParser } from 'fast-xml-parser';
import { fetchText, fetchXml } from './shared/http';
import { upsertBatch } from './shared/upsert';
import {
  canonicalCity,
  mapPropertyType,
  normalizeWhitespace,
  parseInteger,
  parseCOP,
} from './shared/normalize';
import type {
  ListingType,
  PropertyType,
  ScrapeResult,
  ScrapedProperty,
} from './shared/types';

export const CIENCUADRAS_ROOT_SITEMAP = 'https://www.ciencuadras.com/sitemap.xml';

const DEFAULT_CITIES = ['bogota', 'medellin', 'cali', 'barranquilla', 'cartagena'];
const DEFAULT_OPS: CiencuadrasOptions['listingTypes'] = ['venta', 'arriendo'];

const SLUG_TYPES = [
  'apartaestudio',
  'apartamento',
  'casa',
  'oficina',
  'local',
  'lote',
  'finca',
  'bodega',
  'consultorio',
];

const SLUG_CITIES = [
  'bogota',
  'medellin',
  'cali',
  'barranquilla',
  'cartagena',
  'bucaramanga',
  'pereira',
  'manizales',
  'ibague',
  'armenia',
];

export interface CiencuadrasOptions {
  maxListings?: number;
  /** Slugs de ciudades (sin tildes) que usa Ciencuadras en sitemap. */
  cities?: string[];
  listingTypes?: Array<'venta' | 'arriendo'>;
  /** Cursor incremental — url_idx global en la queue round-robin. */
  cursor?: { url_idx?: number };
}

// ============================================================================
// SCRAPER PRINCIPAL
// ============================================================================

export async function scrapeCiencuadras(
  opts: CiencuadrasOptions = {}
): Promise<ScrapeResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const result: ScrapeResult = {
    portal: 'ciencuadras',
    startedAt,
    finishedAt: '',
    durationMs: 0,
    discovered: 0,
    fetched: 0,
    parsed: 0,
    upserted: 0,
    duplicates: 0,
    errors: [],
  };

  // Default 1500: con sitemap discovery + detail fetch ~1s c/u, ~25 min
  // de corrida completa. Vercel Pro (800s) lo soporta si corre solo.
  const maxListings = opts.maxListings ?? 1500;
  const cities = opts.cities ?? DEFAULT_CITIES;
  const listingTypes = opts.listingTypes ?? DEFAULT_OPS!;

  // 1. Root sitemap → encontrar sub-índices "detalles-inmuebles-{op}"
  let opIndices: string[];
  try {
    opIndices = await findOpIndices(listingTypes);
  } catch (err) {
    result.errors.push({
      url: CIENCUADRAS_ROOT_SITEMAP,
      stage: 'discovery',
      message: err instanceof Error ? err.message : String(err),
    });
    return finalize(result, t0);
  }

  // 2. Por cada op-index → encontrar sub-sitemaps por ciudad
  // 3. Por cada (op, city) sub-sitemap → recolectar listing URLs (round-robin)
  const urlsByCombo: Array<string[]> = [];
  for (const opIndex of opIndices) {
    let citySubmaps: string[];
    try {
      citySubmaps = await findCitySubmaps(opIndex, cities);
    } catch (err) {
      result.errors.push({
        url: opIndex,
        stage: 'discovery',
        message: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    for (const sub of citySubmaps) {
      try {
        const urls = await collectListingUrls(sub);
        if (urls.length > 0) urlsByCombo.push(urls);
      } catch (err) {
        result.errors.push({
          url: sub,
          stage: 'discovery',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // 4. Round-robin: tomamos 1 URL de cada combo para diversidad geográfica.
  const queue: string[] = roundRobinFlatten(urlsByCombo);
  result.discovered = queue.length;

  // 5. Detail-fetch + parse hasta llenar maxListings (cursor-aware).
  const items: ScrapedProperty[] = [];
  const seen = new Set<string>();
  const startIdx = opts.cursor?.url_idx ?? 0;
  let nextIdx = startIdx;
  for (let i = startIdx; i < queue.length; i++) {
    const url = queue[i];
    if (items.length >= maxListings) {
      nextIdx = i;
      break;
    }
    nextIdx = i + 1;
    if (seen.has(url)) continue;
    seen.add(url);

    let html: string;
    try {
      html = await fetchText(url, { portal: 'ciencuadras' });
      result.fetched++;
    } catch (err) {
      result.errors.push({
        url,
        stage: 'fetch',
        message: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    try {
      const item = parseCiencuadrasListing(url, html);
      if (item) {
        items.push(item);
        result.parsed++;
      }
    } catch (err) {
      result.errors.push({
        url,
        stage: 'parse',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Cursor: si terminamos toda la queue, reset a 0 (re-escaneo refresca).
  if (nextIdx >= queue.length) nextIdx = 0;
  result.nextCursor = { last_url_idx: nextIdx };

  if (items.length > 0) {
    try {
      const r = await upsertBatch(items);
      result.upserted = r.inserted + r.updated;
      result.duplicates = r.duplicates;
      for (const e of r.errors) {
        result.errors.push({ url: e.url, stage: 'upsert', message: e.error });
      }
    } catch (err) {
      result.errors.push({
        url: '<batch>',
        stage: 'upsert',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return finalize(result, t0);
}

function finalize(result: ScrapeResult, t0: number): ScrapeResult {
  result.finishedAt = new Date().toISOString();
  result.durationMs = Date.now() - t0;
  return result;
}

// ============================================================================
// DISCOVERY: sitemap traversal
// ============================================================================

async function findOpIndices(ops: string[]): Promise<string[]> {
  const xml = await fetchXml(CIENCUADRAS_ROOT_SITEMAP, { portal: 'ciencuadras' });
  const sitemaps = parseSitemapIndex(xml);
  return sitemaps.filter((u) =>
    ops.some((op) => u.includes(`sitemap-index-detalles-inmuebles-${op}.xml`))
  );
}

async function findCitySubmaps(opIndex: string, cities: string[]): Promise<string[]> {
  const xml = await fetchXml(opIndex, { portal: 'ciencuadras' });
  const sitemaps = parseSitemapIndex(xml);
  return sitemaps.filter((u) => {
    // ej "sitemap-detalles-venta-bogota.xml" o "sitemap-detalles-venta-bogota-3.xml"
    return cities.some((c) => {
      const tail = u.split('/').pop() ?? '';
      return new RegExp(`-${c}(-\\d+)?\\.xml$`).test(tail);
    });
  });
}

async function collectListingUrls(sitemapUrl: string): Promise<string[]> {
  const xml = await fetchXml(sitemapUrl, { portal: 'ciencuadras' });
  return parseUrlSet(xml);
}

function parseSitemapIndex(xml: string): string[] {
  const parser = new XMLParser({ ignoreAttributes: true });
  const data = parser.parse(xml);
  const raw = data?.sitemapindex?.sitemap;
  const list: Array<{ loc?: string }> = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.map((s) => s?.loc).filter((u): u is string => typeof u === 'string');
}

function parseUrlSet(xml: string): string[] {
  const parser = new XMLParser({ ignoreAttributes: true });
  const data = parser.parse(xml);
  const raw = data?.urlset?.url;
  const list: Array<{ loc?: string }> = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.map((u) => u?.loc).filter((u): u is string => typeof u === 'string');
}

// Toma URL[0] de combo[0], URL[0] de combo[1], ... URL[0] de combo[N-1],
// luego URL[1] de combo[0], etc. Resultado: cantidad balanceada por combo.
function roundRobinFlatten(buckets: string[][]): string[] {
  const out: string[] = [];
  if (buckets.length === 0) return out;
  let pos = 0;
  let added = true;
  while (added) {
    added = false;
    for (const b of buckets) {
      if (pos < b.length) {
        out.push(b[pos]);
        added = true;
      }
    }
    pos++;
  }
  return out;
}

// ============================================================================
// PARSER DE DETAIL PAGE (Product JSON-LD)
// ============================================================================

interface JsonLdProduct {
  '@type'?: string;
  name?: string;
  description?: string;
  image?: string | string[];
  url?: string;
  offers?: {
    price?: string | number;
    priceCurrency?: string;
    category?: string;
    itemOffered?: {
      '@type'?: string;
      address?: { addressLocality?: string; addressRegion?: string };
      geo?: { latitude?: string | number; longitude?: string | number };
      floorSize?: { value?: string | number; unitCode?: string };
      numberOfRooms?: string | number;
      numberOfBathroomsTotal?: string | number;
    };
  };
}

export function parseCiencuadrasListing(
  url: string,
  html: string
): ScrapedProperty | null {
  const $ = cheerio.load(html);
  const ogUrl = $('meta[property="og:url"]').attr('content');
  const effectiveUrl = ogUrl ?? url;

  const product = findProductJsonLd($);
  const slug = parseCiencuadrasSlug(effectiveUrl);

  // Necesitamos al menos slug (para tipo + op + id).
  if (!slug) return null;

  // Property type del slug.
  const propertyType = mapPropertyType(slug.type);
  if (!propertyType) return null;

  // Listing type del slug (más confiable que offers.category).
  const listingType: ListingType =
    slug.op === 'venta' ? 'venta' : 'arriendo';

  // Price: preferir JSON-LD offers.price (ya es número o string limpia).
  let price: number | null = null;
  if (product?.offers?.price != null) {
    price = parseCOP(product.offers.price);
  }
  if (!price) {
    // Fallback: og:title contiene "Precio $&nbsp;208.000.000,00"
    const ogTitle = $('meta[property="og:title"]').attr('content') ?? '';
    const m = ogTitle.match(/Precio\s*\$?\s*([\d.,&nbsp;\s]+)/i);
    if (m) price = parseCOP(m[1].replace(/&nbsp;/g, ' '));
  }
  if (!price) return null;

  // Address (de itemOffered).
  const itemOffered = product?.offers?.itemOffered;
  const cityRaw = itemOffered?.address?.addressRegion ?? slug.city;
  const city = canonicalCity(cityRaw) ?? cityRaw ?? 'Bogotá';

  // Neighborhood: preferir slug (más específico — "tuna-alta") sobre
  // addressLocality (suele ser zone "Suba").
  const neighborhood = slug.neighborhood ? prettify(slug.neighborhood) : itemOffered?.address?.addressLocality;

  // Specs.
  const area_m2 = toIntOrNull(itemOffered?.floorSize?.value);
  const bedrooms = toIntOrNull(itemOffered?.numberOfRooms);
  const bathrooms = toIntOrNull(itemOffered?.numberOfBathroomsTotal);

  // Geo (string en JSON-LD).
  const lat = toNumberOrNull(itemOffered?.geo?.latitude);
  const lng = toNumberOrNull(itemOffered?.geo?.longitude);

  // Title (limpiar el "Precio $..." del og:title).
  let title: string;
  if (product?.name) {
    title = product.name;
  } else {
    const ogTitle = $('meta[property="og:title"]').attr('content') ?? '';
    title = ogTitle.replace(/,?\s*Precio\s*\$.*$/i, '').trim();
  }
  title = normalizeWhitespace(title) || `${propertyType} en ${city}`;

  // Description.
  let description: string | undefined;
  if (product?.description) {
    description = normalizeWhitespace(product.description);
  } else {
    const ogDesc = $('meta[property="og:description"]').attr('content');
    if (ogDesc) description = normalizeWhitespace(ogDesc);
  }

  // Photos.
  const photos: string[] = [];
  const heroImage = $('meta[property="og:image"]').attr('content');
  if (typeof product?.image === 'string') {
    photos.push(product.image);
  } else if (Array.isArray(product?.image)) {
    photos.push(...product.image.filter((u): u is string => typeof u === 'string'));
  } else if (heroImage) {
    photos.push(heroImage);
  }

  return {
    source_portal: 'ciencuadras',
    source_url: effectiveUrl,
    title,
    description,
    price_cop: price,
    city,
    neighborhood: neighborhood || undefined,
    bedrooms: bedrooms ?? undefined,
    bathrooms: bathrooms ?? undefined,
    area_m2: area_m2 ?? undefined,
    property_type: propertyType,
    listing_type: listingType,
    photos,
    latitude: lat ?? undefined,
    longitude: lng ?? undefined,
  };
}

function findProductJsonLd($: cheerio.CheerioAPI): JsonLdProduct | null {
  let result: JsonLdProduct | null = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (result) return;
    try {
      const parsed = JSON.parse($(el).contents().text());
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const it of items) {
        if (it?.['@type'] === 'Product') {
          result = it as JsonLdProduct;
          return;
        }
      }
    } catch {
      // skip malformed
    }
  });
  return result;
}

interface SlugInfo {
  type: string;
  op: 'venta' | 'arriendo';
  neighborhood?: string;
  city: string;
  id: string;
}

// URL pattern: /inmueble/{type}-en-{op}-en-{hood-slug}-{city}-{id}
// Ej: /inmueble/apartamento-en-venta-en-tuna-alta-bogota-3713891
//     /inmueble/casa-en-venta-en-casa-blanca-suba-bogota-3091390
export function parseCiencuadrasSlug(url: string): SlugInfo | null {
  const m = url.match(/\/inmueble\/([a-z0-9-]+)-(\d+)\/?(?:$|\?)/);
  if (!m) return null;
  const slug = m[1];
  const id = m[2];

  // Tipo en el inicio del slug (no LAST como Fincaraíz porque acá
  // el slug NO tiene prefijo de proyecto).
  let type = '';
  for (const t of SLUG_TYPES) {
    if (slug.startsWith(`${t}-en-`)) {
      type = t;
      break;
    }
  }
  if (!type) return null;

  // Después de "{type}-en-" viene "{op}-en-{hood-y-city}"
  const afterType = slug.slice(type.length + 4); // +4 = "-en-"
  const opMatch = afterType.match(/^(venta|arriendo)-en-(.+)$/);
  if (!opMatch) return null;
  const op = opMatch[1] as 'venta' | 'arriendo';
  const hoodAndCity = opMatch[2];

  // Encontrar ciudad como sufijo conocido.
  const cityMatch = SLUG_CITIES.find(
    (c) => hoodAndCity === c || hoodAndCity.endsWith(`-${c}`)
  );
  if (cityMatch) {
    const hoodPart = hoodAndCity.slice(0, hoodAndCity.length - cityMatch.length - 1);
    return {
      type,
      op,
      neighborhood: hoodPart || undefined,
      city: cityMatch,
      id,
    };
  }

  // Fallback: último token = ciudad.
  const tokens = hoodAndCity.split('-');
  return {
    type,
    op,
    neighborhood: tokens.length > 1 ? tokens.slice(0, -1).join('-') : undefined,
    city: tokens[tokens.length - 1],
    id,
  };
}

function prettify(slugPart: string): string {
  return slugPart
    .split('-')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

function toIntOrNull(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Math.round(v);
  return parseInteger(String(v));
}

function toNumberOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
