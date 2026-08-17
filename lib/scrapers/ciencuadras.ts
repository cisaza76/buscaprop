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
import {
  parseUrlSetWithLastmod,
  filterUrlsToScrape,
  type SitemapEntry,
} from './shared/sitemap';
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
  /** Cursor incremental — {sitemap_idx, url_idx} sobre la lista estable de submaps. */
  cursor?: { sitemap_idx?: number; url_idx?: number };
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

  // Tope de fetches reales por corrida (defensa anti-storm). Sin esto, un
  // sitemap donde la mayoría de listings no parsean (ej. formato nuevo no
  // soportado) nunca llena `items>=maxListings` y el loop drena el sitemap
  // entero → timeout de Inngest → reintento desde el mismo cursor → loop
  // infinito (ver incidente 2026-06-02). Con el tope, el cursor SIEMPRE avanza
  // ~maxFetchAttempts por tick aunque todo sea null. 4× da margen para que los
  // fallos de parse no impidan juntar maxListings parseables en el caso normal.
  const maxFetchAttempts = maxListings * 4;

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

  // 2. Por cada op-index → sub-sitemaps por ciudad. Construimos una LISTA
  // ESTABLE y ordenada de submaps (op × ciudad). El cursor indexa esta lista
  // por sitemap_idx + posición dentro (url_idx), igual que Fincaraíz. Es robusto
  // ante cambios en el contenido de un sitemap: el blast-radius de un drift es
  // UN submap, no toda la cola nacional (el modelo viejo de url_idx global sobre
  // una queue round-robin re-armada cada tick se desalineaba al cambiar el
  // sitemap, saltándose o re-scrapeando inventario).
  const submaps: string[] = [];
  for (const opIndex of opIndices) {
    try {
      const citySubmaps = await findCitySubmaps(opIndex, cities);
      submaps.push(...citySubmaps);
    } catch (err) {
      result.errors.push({
        url: opIndex,
        stage: 'discovery',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  submaps.sort(); // orden determinístico entre ticks.

  // 3. Iteración cursor-aware desde {sitemap_idx, url_idx}. Cada submap se
  // carga on-demand (no todos a la vez).
  const startSitemapIdx = opts.cursor?.sitemap_idx ?? 0;
  let startUrlIdx = opts.cursor?.url_idx ?? 0;

  const items: ScrapedProperty[] = [];
  const seen = new Set<string>();
  let nextSitemapIdx = startSitemapIdx;
  let nextUrlIdx = startUrlIdx;
  let skippedByCache = 0;
  let attempted = 0; // fetches reales este tick — bound anti-storm

  outer: for (let sIdx = startSitemapIdx; sIdx < submaps.length; sIdx++) {
    const sitemapUrl = submaps[sIdx];
    let entries: SitemapEntry[];
    try {
      entries = await collectListingEntries(sitemapUrl);
    } catch (err) {
      result.errors.push({
        url: sitemapUrl,
        stage: 'discovery',
        message: err instanceof Error ? err.message : String(err),
      });
      nextSitemapIdx = sIdx + 1;
      nextUrlIdx = 0;
      startUrlIdx = 0;
      continue;
    }
    result.discovered += entries.length;

    // Cache-by-lastmod: lookahead dentro de este submap (limita el .in() a un
    // tamaño razonable). 5x maxListings de buffer por si la mayoría hit cache.
    const lookahead = entries.slice(startUrlIdx, startUrlIdx + maxListings * 5);
    const toFetch = await filterUrlsToScrape('ciencuadras', lookahead);
    const fetchSet = new Set(toFetch.map((e) => e.url));
    const lookaheadEnd = startUrlIdx + lookahead.length;

    for (let uIdx = startUrlIdx; uIdx < entries.length; uIdx++) {
      // Cortamos por items parseados O por fetches intentados (lo segundo
      // garantiza avance del cursor aunque casi nada parsee → anti-storm).
      if (items.length >= maxListings || attempted >= maxFetchAttempts) {
        nextSitemapIdx = sIdx;
        nextUrlIdx = uIdx;
        break outer;
      }
      const entry = entries[uIdx];
      if (seen.has(entry.url)) continue;
      seen.add(entry.url);

      // Cache hit dentro de la ventana de lookahead → skip sin fetchear.
      if (uIdx < lookaheadEnd && !fetchSet.has(entry.url)) {
        skippedByCache++;
        continue;
      }

      attempted++;
      let html: string;
      try {
        html = await fetchText(entry.url, { portal: 'ciencuadras' });
        result.fetched++;
      } catch (err) {
        result.errors.push({
          url: entry.url,
          stage: 'fetch',
          message: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
      try {
        const item = parseCiencuadrasListing(entry.url, html);
        if (item) {
          if (entry.lastmod) item.source_lastmod = entry.lastmod;
          items.push(item);
          result.parsed++;
        }
      } catch (err) {
        result.errors.push({
          url: entry.url,
          stage: 'parse',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    nextSitemapIdx = sIdx + 1;
    nextUrlIdx = 0;
    startUrlIdx = 0;
  }
  if (skippedByCache > 0) {
    console.log(`[ciencuadras] cache-by-lastmod: skipped ${skippedByCache} URLs sin cambios`);
  }

  // Si recorrimos todos los submaps, completamos ciclo → reset a (0,0).
  if (nextSitemapIdx >= submaps.length) {
    nextSitemapIdx = 0;
    nextUrlIdx = 0;
  }

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

  result.nextCursor = {
    last_sitemap_idx: nextSitemapIdx,
    last_url_idx: nextUrlIdx,
  };

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

async function collectListingEntries(sitemapUrl: string): Promise<SitemapEntry[]> {
  const xml = await fetchXml(sitemapUrl, { portal: 'ciencuadras' });
  return parseUrlSetWithLastmod(xml);
}

function parseSitemapIndex(xml: string): string[] {
  const parser = new XMLParser({ ignoreAttributes: true });
  const data = parser.parse(xml);
  const raw = data?.sitemapindex?.sitemap;
  const list: Array<{ loc?: string }> = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.map((s) => s?.loc).filter((u): u is string => typeof u === 'string');
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

  // Contacto: no está en el JSON-LD, sólo en el blob detail-state.
  const contact = extractCiencuadrasContact(parseCiencuadrasDetailState(html));

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
    contact_phone: contact.contact_phone,
    company_name: contact.company_name,
    // contact_name se deja vacío a propósito: el portal sólo publica razón
    // social (realStateName / advisoryName), nunca nombre de persona.
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Contacto
//
// El teléfono NO está en el JSON-LD. Vive en un blob de Angular
// TransferState: <script id="detail-state" type="application/json"> con las
// comillas escapadas como &q;. Adentro, la ficha cuelga de una key dinámica
// `detail-property-{path}` con dos sub-objetos que nos interesan:
//   generalData: whatsAppContact, advisoryPhone, advisorWhatsapp, phoneList[],
//                advisoryName, allowContact{Whatsapp,Call,Email}
//   dataStrip:   realStateName (nombre comercial de la inmobiliaria)
// ─────────────────────────────────────────────────────────────────────────

// Mapa de escape de Angular TransferState. Un solo pase para no
// des-escapar dos veces (un '&a;q;' literal no debe volverse '"').
const NG_UNESCAPE: Record<string, string> = {
  '&a;': '&',
  '&q;': '"',
  '&s;': "'",
  '&l;': '<',
  '&g;': '>',
  '&b;': '\\',
};

export function parseCiencuadrasDetailState(html: string): unknown {
  const m = html.match(
    /<script id="detail-state" type="application\/json">([\s\S]*?)<\/script>/
  );
  if (!m) return null;
  const json = m[1].replace(/&[aqslgb];/g, (t) => NG_UNESCAPE[t] ?? t);
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// Normaliza a celular colombiano en E.164 sin '+': 57 + 3XXXXXXXXX.
// Devuelve null para fijos (numeración 60X), formatos viejos de 7 dígitos y
// basura. contact_phone alimenta links wa.me — un fijo daría un link muerto.
export function normalizeCoMobile(raw: unknown): string | null {
  if (raw == null) return null;
  const d = String(raw).replace(/\D/g, '');
  if (d.length === 10 && d.startsWith('3')) return `57${d}`;
  if (d.length === 12 && d.startsWith('573')) return d;
  return null;
}

interface CiencuadrasContact {
  contact_phone?: string;
  company_name?: string;
}

export function extractCiencuadrasContact(state: unknown): CiencuadrasContact {
  if (!state || typeof state !== 'object') return {};
  const key = Object.keys(state as Record<string, unknown>).find((k) =>
    k.startsWith('detail-property-')
  );
  if (!key) return {};
  const detail = (state as Record<string, any>)[key];
  if (!detail || typeof detail !== 'object') return {};

  // Ficha caída: el portal responde 200 con {error, message} y sin
  // generalData en vez de un 404.
  const g = detail.generalData ?? {};
  const ds = detail.dataStrip ?? {};

  const company_name: string | undefined = ds.realStateName || g.advisoryName || undefined;

  // Respetar los flags de consentimiento del anunciante: si bloqueó tanto
  // WhatsApp como llamada, no publicamos su número.
  if (g.allowContactWhatsapp === false && g.allowContactCall === false) {
    return { company_name };
  }

  // Preferir el número del botón de WhatsApp: es el canal que el anunciante
  // usa para recibir leads. Después los del asesor, y de último la lista
  // cruda.
  const direct = [g.whatsAppContact, g.advisorWhatsapp, g.advisoryPhone];
  for (const cand of direct) {
    const phone = normalizeCoMobile(cand);
    if (phone) return { contact_phone: phone, company_name };
  }
  for (const entry of Array.isArray(g.phoneList) ? g.phoneList : []) {
    // type 'C' = celular, 'F' = fijo. isVisible '0' = el anunciante lo
    // marcó como no publicable.
    if (entry?.type !== 'C' || String(entry?.isVisible) !== '1') continue;
    const phone = normalizeCoMobile(entry.phone);
    if (phone) return { contact_phone: phone, company_name };
  }
  return { company_name };
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

  // Después de "{type}-en-" viene "{op}-en-{hood-y-city}". La operación puede
  // ser simple ("venta"/"arriendo") o DUAL ("arriendo-o-venta"/"venta-o-arriendo")
  // — ciencuadras publica muchos listings en venta+arriendo a la vez. Sin esto,
  // el slug no matcheaba, el parser devolvía null en masa, y el loop drenaba
  // sitemaps enteros hasta timeoutear (ver incidente 2026-06-02). Alternativas
  // largas primero para que el regex matchee la dual antes que la simple.
  const afterType = slug.slice(type.length + 4); // +4 = "-en-"
  const opMatch = afterType.match(
    /^(arriendo-o-venta|venta-o-arriendo|venta|arriendo)-en-(.+)$/
  );
  if (!opMatch) return null;
  // Dual → 'venta' (Buscaprop es buyer-first; el precio de venta es el dato
  // dominante). Solo 'arriendo' puro queda como arriendo.
  const op: 'venta' | 'arriendo' = opMatch[1] === 'arriendo' ? 'arriendo' : 'venta';
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
