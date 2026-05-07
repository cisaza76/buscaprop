// lib/scrapers/metrocuadrado.ts
// Scraper de MetroCuadrado — strategy SEARCH-ONLY:
// 1 HTTP request por combo (city × type × op) → ~50-70 listings inline
// en el RSC payload del HTML. No requiere Playwright ni detail-fetching.
//
// Trade-offs documentados:
// - lat/lng ausentes (solo en detail page)
// - description ausente (solo en detail page)
// - 1 sola foto por listing (gallery completa solo en detail)
//
// Si se necesita data completa: enriquecer con `enrichWithDetail`
// (configurable via opts.enrichWithDetail = true).

import { fetchText } from './shared/http';
import { upsertBatch } from './shared/upsert';
import {
  canonicalCity,
  isValidColombiaCoord,
  mapPropertyType,
  normalizeWhitespace,
  parseInteger,
} from './shared/normalize';
import type {
  ListingType,
  PropertyType,
  ScrapeResult,
  ScrapedProperty,
} from './shared/types';

const M2_BASE = 'https://www.metrocuadrado.com';

// UA browser-like — M2 NO bloquea UA "BuscaProp", pero damos browser por
// consistencia con Properati y para no destacar.
const M2_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 BuscaProp/1.0';

const DEFAULT_CITIES = ['bogota', 'medellin', 'cali', 'barranquilla', 'cartagena'];
const DEFAULT_TYPES: MetroCuadradoOptions['propertyTypes'] = [
  'apartamento',
  'casa',
  'oficina',
  'lote',
];
const DEFAULT_OPS: MetroCuadradoOptions['listingTypes'] = ['venta', 'arriendo'];

/**
 * Barrios premium por ciudad (slug M2). Cada combo {city, type, op, barrio}
 * suma ~50 listings adicionales que NO se capturan con la búsqueda city-level.
 * MetroCuadrado solo devuelve ~70 listings por página inicial — sin paginación
 * real (vía API AWS) la única forma de capturar más es agregar combos por
 * barrio.
 *
 * Con 12 barrios bogotanos × 4 tipos × 2 ops = 96 combos extra → ~5000 listings
 * adicionales solo en Bogotá. Lista enfocada en barrios donde el mercado de
 * BuscaProp tiene más demanda (premium + medio-alto).
 */
const DEFAULT_BARRIOS: Record<string, string[]> = {
  bogota: [
    'rosales',
    'chapinero',
    'usaquen',
    'chico-norte',
    'cabrera',
    'nogal',
    'santa-barbara',
    'cedritos',
    'santa-ana',
    'quinta-camacho',
    'salitre',
    'modelia',
  ],
  medellin: ['poblado', 'laureles', 'envigado', 'sabaneta', 'belen'],
  cali: ['ciudad-jardin', 'el-penon'],
  cartagena: ['centro-historico', 'bocagrande', 'manga'],
};

export interface MetroCuadradoOptions {
  /** Máximo de propiedades a insertar. Default 5000. */
  maxListings?: number;
  /** Slugs de ciudades en el path M2 (sin tildes). */
  cities?: string[];
  propertyTypes?: Array<'apartamento' | 'casa' | 'oficina' | 'lote'>;
  listingTypes?: Array<'venta' | 'arriendo'>;
  /**
   * Si true (default), agrega combos por barrio premium para capturar más
   * inventario (M2 no soporta paginación real desde el HTML; cada barrio es
   * una página fresca). Pasar false solo para scraping rápido city-level.
   */
  scrapByBarrios?: boolean;
  /**
   * Si true, fetch detail page por cada listing para añadir
   * coordinates + description + gallery completa. ~10× más lento (1 request
   * extra por listing) pero CRÍTICO: las coords solo aparecen en detail.
   * Default true desde Phase 10 — sin coords no podemos enriquecer con IDECA.
   * Pasar false explícitamente solo en tests / debugging local.
   */
  enrichWithDetail?: boolean;
  /** Cursor incremental — para reanudar desde último combo procesado. */
  cursor?: { combo_idx?: number };
}

// ============================================================================
// SCRAPER PRINCIPAL
// ============================================================================

export async function scrapeMetroCuadrado(
  opts: MetroCuadradoOptions = {}
): Promise<ScrapeResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const result: ScrapeResult = {
    portal: 'metrocuadrado',
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

  const maxListings = opts.maxListings ?? 5000;
  const cities = opts.cities ?? DEFAULT_CITIES;
  const propertyTypes = opts.propertyTypes ?? DEFAULT_TYPES!;
  const listingTypes = opts.listingTypes ?? DEFAULT_OPS!;
  const scrapByBarrios = opts.scrapByBarrios !== false;

  // Combos: city-level primero (resultados generales) + barrio-level para
  // ciudades con barrios listados en DEFAULT_BARRIOS. M2 no permite paginar
  // realmente desde HTML — cada combo barrio es la única forma de capturar
  // inventario adicional sin reverse-engineering la API AWS.
  const combos: Array<{ city: string; type: string; op: string; barrio?: string }> = [];
  for (const op of listingTypes) {
    for (const type of propertyTypes) {
      // City-level primero (resultados base, ~50-70 listings cada uno).
      for (const city of cities) {
        combos.push({ city, type, op });
      }
      // Barrio-level después (~50 listings extra por barrio).
      if (scrapByBarrios) {
        for (const city of cities) {
          const barrios = DEFAULT_BARRIOS[city] ?? [];
          for (const barrio of barrios) {
            combos.push({ city, type, op, barrio });
          }
        }
      }
    }
  }

  const items: ScrapedProperty[] = [];
  const seenIds = new Set<string>();

  // Cursor: empezar desde el combo guardado.
  const startComboIdx = opts.cursor?.combo_idx ?? 0;
  let nextComboIdx = startComboIdx;

  for (let i = startComboIdx; i < combos.length; i++) {
    const combo = combos[i];
    if (items.length >= maxListings) {
      nextComboIdx = i;
      break;
    }
    // Si terminamos de iterar sin parar, dejamos nextComboIdx en el siguiente.
    nextComboIdx = i + 1;

    // URL con barrio si aplica: /apartamento/arriendo/bogota/rosales/
    const url = combo.barrio
      ? `${M2_BASE}/${combo.type}/${combo.op}/${combo.city}/${combo.barrio}/`
      : `${M2_BASE}/${combo.type}/${combo.op}/${combo.city}/`;
    let html: string;
    try {
      html = await fetchText(url, { userAgent: M2_UA });
      result.fetched++;
    } catch (err) {
      result.errors.push({
        url,
        stage: 'fetch',
        message: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    let chunks: string[];
    let raw: unknown[] | null;
    try {
      chunks = extractRscChunks(html);
      raw = extractSearchResults(chunks);
    } catch (err) {
      result.errors.push({
        url,
        stage: 'parse',
        message: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    if (!raw || raw.length === 0) {
      result.errors.push({
        url,
        stage: 'parse',
        message: 'no results array found in RSC chunks',
      });
      continue;
    }

    result.discovered += raw.length;
    for (const item of raw) {
      if (items.length >= maxListings) break;
      try {
        const mapped = mapSearchResultToProperty(item, url);
        if (!mapped) continue;
        if (seenIds.has(mapped.source_url)) continue; // dedup intra-run
        seenIds.add(mapped.source_url);
        items.push(mapped);
        result.parsed++;
      } catch (err) {
        result.errors.push({
          url: getResultLink(item) ?? url,
          stage: 'parse',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // Si recorrimos todos los combos sin llenar maxListings: cursor a 0 (refresca).
  if (nextComboIdx >= combos.length) {
    nextComboIdx = 0;
  }
  result.nextCursor = { last_combo_idx: nextComboIdx };

  // Enriquecer con detail-fetch. Default true desde Phase 10 — sin esto
  // las coords no se extraen y bloquea el pipeline de enrichment con IDECA.
  // Solo se salta si explícitamente se pasó enrichWithDetail=false.
  const shouldEnrich = opts.enrichWithDetail !== false;
  if (shouldEnrich) {
    for (const item of items) {
      try {
        await enrichWithDetail(item);
      } catch (err) {
        result.errors.push({
          url: item.source_url,
          stage: 'fetch',
          message: `enrich: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }

  // Upsert batch.
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
// PARSER RSC
// ============================================================================

/**
 * Extrae todos los chunks `self.__next_f.push([1, "<contenido>"])` y los
 * decodifica (escapes JS → string crudo).
 */
export function extractRscChunks(html: string): string[] {
  const re = /self\.__next_f\.push\(\[1,\s*"((?:\\.|[^"\\])*)"\]\)/g;
  const out: string[] = [];
  for (const m of html.matchAll(re)) {
    try {
      out.push(JSON.parse('"' + m[1] + '"'));
    } catch {
      // chunk malformado — skip
    }
  }
  return out;
}

/**
 * Localiza el chunk decodificado que contiene el array `results` con los
 * listings y devuelve el array parseado.
 */
export function extractSearchResults(chunks: string[]): unknown[] | null {
  for (const c of chunks) {
    if (!c.includes('"results":[') || !c.includes('"midinmueble":"')) continue;
    const startKey = c.indexOf('"results":[');
    const startBracket = startKey + '"results":'.length; // posición del `[`
    const arrayJson = balanceExtract(c, startBracket, '[', ']');
    if (!arrayJson) continue;
    try {
      const parsed = JSON.parse(arrayJson);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // probar siguiente chunk
    }
  }
  return null;
}

/**
 * Localiza el chunk de un detail page y devuelve el objeto `data` con
 * coordinates, comment, images, etc.
 */
export function extractDetailData(chunks: string[]): Record<string, any> | null {
  for (const c of chunks) {
    if (!c.includes('"propertyId":"') || !c.includes('"propertyType":')) continue;
    const m = c.match(/"data":\{/);
    if (!m || m.index == null) continue;
    const startBrace = m.index + '"data":'.length; // posición del `{`
    const objJson = balanceExtract(c, startBrace, '{', '}');
    if (!objJson) continue;
    try {
      const parsed = JSON.parse(objJson);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // siguiente
    }
  }
  return null;
}

/**
 * Walks forward from `startIdx` (apuntando a `openChar`) hasta encontrar
 * el matching `closeChar`. Respeta strings JSON con escapes.
 * Devuelve el substring inclusive (con ambos delimitadores).
 */
function balanceExtract(
  text: string,
  startIdx: number,
  openChar: string,
  closeChar: string
): string | null {
  if (text[startIdx] !== openChar) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (ch === '\\') {
      esc = true;
      continue;
    }
    if (inStr) {
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === openChar) depth++;
    else if (ch === closeChar) {
      depth--;
      if (depth === 0) return text.slice(startIdx, i + 1);
    }
  }
  return null;
}

// ============================================================================
// MAPEO RESULT → ScrapedProperty
// ============================================================================

interface M2SearchResult {
  midinmueble?: string;
  link?: string;
  title?: string;
  imageLink?: string;
  mtipoinmueble?: { id?: string; nombre?: string };
  mtiponegocio?: string;
  mvalorventa?: number | null;
  mvalorarriendo?: number | null;
  marea?: number | null;
  areaprivada?: number | null;
  mnrocuartos?: number | string | null;
  mnrobanos?: number | string | null;
  mciudad?: { id?: string; nombre?: string };
  mbarrio?: string | null;
  mzona?: string | null;
  mestadoinmueble?: string;
  mnombreproyecto?: string | null;
  /** Teléfono de la inmobiliaria (el campo M2 trae 10 dígitos sin prefijo país). */
  contactPhone?: string | number | null;
  /** WhatsApp ya viene con prefijo país (ej "573108200107"). */
  whatsapp?: string | number | null;
  /** ID numérico de la empresa (no nos sirve sin lookup separado). */
  midempresa?: string | number | null;
  /** Nombre de la inmobiliaria que publicó. NO está en search inline; solo en
   *  detail page. enrichWithDetail() lo puebla cuando se activa. */
  mnombreinmobiliaria?: string | null;
}

function getResultLink(item: unknown): string | null {
  if (!item || typeof item !== 'object') return null;
  const link = (item as M2SearchResult).link;
  return typeof link === 'string' ? link : null;
}

export function mapSearchResultToProperty(
  raw: unknown,
  searchUrl: string
): ScrapedProperty | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as M2SearchResult;

  // Necesitamos al menos: link (URL), tipo, ciudad, precio.
  if (!r.link || typeof r.link !== 'string') return null;
  if (!r.midinmueble) return null;

  const propertyType = mapPropertyType(r.mtipoinmueble?.nombre ?? '');
  if (!propertyType) return null;

  // Determinar listing_type: la operación viene en mtiponegocio o por
  // qué precio está poblado. Search URL contiene la operación también.
  const listingType = inferListingType(r, searchUrl);
  if (!listingType) return null;

  // Precio según operación.
  const price =
    listingType === 'venta'
      ? toPositive(r.mvalorventa)
      : toPositive(r.mvalorarriendo);
  if (!price) return null;

  // URL absoluta.
  const sourceUrl = r.link.startsWith('http') ? r.link : `${M2_BASE}${r.link}`;

  // Ciudad y barrio.
  const city =
    canonicalCity(r.mciudad?.nombre ?? '') ?? r.mciudad?.nombre ?? 'Bogotá';
  const neighborhood = r.mbarrio ? prettifyAllCaps(r.mbarrio) : undefined;

  // Specs: bedrooms/bathrooms pueden venir como number o string ("3").
  const bedrooms = toNonNegativeInt(r.mnrocuartos);
  const bathrooms = toNonNegativeInt(r.mnrobanos);
  // marea puede ser float (ej 29.58) — redondeamos a entero más cercano.
  const area_m2 = toNonNegativeInt(r.marea ?? r.areaprivada);

  // Photos: 1 sola en search. Si imageLink está vacío, omitir.
  const photos = r.imageLink ? [r.imageLink] : [];

  // Title: preferir el del payload, fallback construido.
  const title = normalizeWhitespace(r.title ?? `${propertyType} en ${city}`);

  // Contacto inline en search results (gold — no requiere detail-fetch).
  // M2 expone contactPhone (10 dígitos) y whatsapp (ya con prefijo 57).
  // Preferimos whatsapp porque es lo que va a wa.me/.
  const phone =
    normalizePhone(r.whatsapp) ?? normalizePhone(r.contactPhone) ?? undefined;

  return {
    source_portal: 'metrocuadrado',
    source_url: sourceUrl,
    title,
    description: undefined, // solo en detail page
    price_cop: price,
    city,
    neighborhood,
    bedrooms: bedrooms ?? undefined,
    bathrooms: bathrooms ?? undefined,
    area_m2: area_m2 ?? undefined,
    property_type: propertyType,
    listing_type: listingType,
    photos,
    latitude: undefined, // solo en detail page
    longitude: undefined,
    contact_phone: phone,
    company_name: r.mnombreinmobiliaria || undefined, // solo si vino en search
  };
}

// Normaliza el phone a E.164 sin '+'. M2 trae a veces sin prefijo (10
// dígitos = celular Colombia) o con prefijo (12 dígitos = 57+celular).
function normalizePhone(raw: unknown): string | null {
  if (raw == null) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('57') && digits.length >= 12) return digits;
  if (digits.length === 10) return `57${digits}`;
  if (digits.length >= 7) return digits; // dejarlo crudo si tiene formato inesperado
  return null;
}

function inferListingType(r: M2SearchResult, searchUrl: string): ListingType | null {
  const negocio = (r.mtiponegocio ?? '').toLowerCase();
  if (negocio === 'venta') return 'venta';
  if (negocio === 'arriendo' || negocio === 'alquiler') return 'arriendo';
  if (toPositive(r.mvalorventa)) return 'venta';
  if (toPositive(r.mvalorarriendo)) return 'arriendo';
  // Fallback: del path del search URL.
  if (searchUrl.includes('/venta/')) return 'venta';
  if (searchUrl.includes('/arriendo/')) return 'arriendo';
  return null;
}

function toPositive(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function toNonNegativeInt(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'string' ? parseInteger(v) : Math.round(v as number);
  if (n == null || !Number.isFinite(n) || n < 0) return null;
  return n;
}

function prettifyAllCaps(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

// ============================================================================
// ENRIQUECIMIENTO OPCIONAL (detail page)
// ============================================================================

interface M2DetailData {
  coordinates?: { lat?: number; lon?: number };
  comment?: string;
  images?: Array<{ image?: string; imageMobile?: string }>;
  /** Datos de la inmobiliaria que publicó (gold — no está en search). */
  companyName?: string;
  contactPhone?: string | number;
  whatsapp?: string | number;
}

export async function enrichWithDetail(item: ScrapedProperty): Promise<void> {
  const html = await fetchText(item.source_url, { userAgent: M2_UA });
  const chunks = extractRscChunks(html);
  const data = extractDetailData(chunks) as M2DetailData | null;

  // Coords primero por la vía rápida (RSC parser) — fast path histórico.
  let lat: number | null = null;
  let lng: number | null = null;
  if (data) {
    if (typeof data.coordinates?.lat === 'number') lat = data.coordinates.lat;
    if (typeof data.coordinates?.lon === 'number') lng = data.coordinates.lon;
  }

  // Fallback: regex directo sobre el HTML raw para casos donde el parser RSC
  // no encontró el chunk (cambios menores en payload). Patrón validado en probe:
  //   \"coordinates\":{\"lon\":-74.84,\"lat\":10.99}
  if (lat === null || lng === null) {
    const m = html.match(/\\"coordinates\\":\{\\"lon\\":(-?[0-9.]+),\\"lat\\":(-?[0-9.]+)\}/);
    if (m) {
      lng = parseFloat(m[1]); // ⚠️ ORDEN: lon es primer grupo, lat segundo
      lat = parseFloat(m[2]);
    }
  }

  // Validar contra bounding box de Colombia. Si no pasa, descartamos y
  // logueamos — nunca persistimos coords inventadas / inválidas.
  if (lat !== null && lng !== null) {
    if (isValidColombiaCoord(lat, lng)) {
      item.latitude = lat;
      item.longitude = lng;
    } else {
      console.warn(
        `[metrocuadrado] coords fuera de Colombia para ${item.source_url}: (${lat}, ${lng}) — descartadas`
      );
    }
  }

  if (!data) return;
  if (data.comment) item.description = normalizeWhitespace(data.comment);
  if (Array.isArray(data.images) && data.images.length > 0) {
    const urls = data.images.map((img) => img?.image).filter((u): u is string => !!u);
    if (urls.length > 0) item.photos = urls;
  }
  // Contacto desde detail page (más rico que search: incluye companyName).
  if (data.companyName && !item.company_name) item.company_name = data.companyName;
  if (!item.contact_phone) {
    const phone = normalizePhone(data.whatsapp) ?? normalizePhone(data.contactPhone);
    if (phone) item.contact_phone = phone;
  }
}
