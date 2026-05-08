// lib/scrapers/fincaraiz.ts
// Scraper de Fincaraíz: sitemap-index → child sitemaps → detail pages.
// Detail pages traen JSON-LD (@type RentAction|SaleAction) con price exacto,
// geo, name, description; complementamos con og: tags para beds/baths/área
// (que la JSON-LD no expone) y parseamos el slug para neighborhood/city.

import * as cheerio from 'cheerio';
import { XMLParser } from 'fast-xml-parser';
import { fetchText, fetchXml } from './shared/http';
import { upsertBatch } from './shared/upsert';
import {
  canonicalCity,
  mapPropertyType,
  normalizeWhitespace,
  parseCOP,
  parseInteger,
} from './shared/normalize';
import type {
  ListingType,
  PropertyType,
  ScrapeResult,
  ScrapedProperty,
} from './shared/types';

export const FINCARAIZ_SITEMAP_INDEX =
  'https://www.fincaraiz.com.co/cde-sitemap-listings-index.xml';

// Defaults pensados para Día 2: priorizamos las 5 ciudades del MVP y los
// tipos con mayor inventario (apartamento + casa) en venta + alquiler.
const DEFAULT_DEPARTMENTS = [
  'bogota-dc',
  'antioquia',
  'valle-del-cauca',
  'atlantico',
  'bolivar',
];
const DEFAULT_TYPES: FincaraizOptions['propertyTypes'] = [
  'apartamento',
  'casa',
  'apartaestudio',
  'oficina',
  'lote',
];
const DEFAULT_OPS: FincaraizOptions['listingTypes'] = ['venta', 'alquiler'];

// Tipos válidos en el slug de Fincaraíz. Orden importa para resolver
// ambigüedades cuando un slug tiene "casa-de-{name}" como prefijo.
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
  'pasto',
  'monteria',
  'villavicencio',
  'cucuta',
];

export interface FincaraizOptions {
  /** Cuántas propiedades insertar como máximo en una corrida. */
  maxListings?: number;
  /** Departamentos del slug (ej: 'bogota-dc', 'antioquia'). */
  departments?: string[];
  propertyTypes?: Array<'apartamento' | 'casa' | 'apartaestudio' | 'oficina' | 'lote'>;
  listingTypes?: Array<'venta' | 'alquiler'>;
  /** Cursor de scraping incremental — para reanudar desde última posición. */
  cursor?: { sitemap_idx?: number; url_idx?: number };
}

export async function scrapeFincaraiz(
  opts: FincaraizOptions = {}
): Promise<ScrapeResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const result: ScrapeResult = {
    portal: 'fincaraiz',
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

  // Default 1500: con sitemap discovery completo + detail fetch ~1s c/u,
  // un run completo tarda ~25 min. Cabe en Vercel Pro (800s) si corre solo
  // este portal. El cron orquesta correr 1 portal por invocación.
  const maxListings = opts.maxListings ?? 1500;
  const departments = opts.departments ?? DEFAULT_DEPARTMENTS;
  const propertyTypes = opts.propertyTypes ?? DEFAULT_TYPES!;
  const listingTypes = opts.listingTypes ?? DEFAULT_OPS!;

  // 1. Descubrir child sitemaps relevantes.
  let childSitemaps: string[];
  try {
    childSitemaps = await discoverChildSitemaps({
      departments,
      propertyTypes,
      listingTypes,
    });
  } catch (err) {
    result.errors.push({
      url: FINCARAIZ_SITEMAP_INDEX,
      stage: 'discovery',
      message: err instanceof Error ? err.message : String(err),
    });
    return finalize(result, t0);
  }

  if (childSitemaps.length === 0) {
    result.errors.push({
      url: FINCARAIZ_SITEMAP_INDEX,
      stage: 'discovery',
      message: 'No matching child sitemaps for filters',
    });
    return finalize(result, t0);
  }

  // 2. Cursor-aware iteration: empezar desde {sitemap_idx, url_idx} guardado.
  // Cargar cada child sitemap on-demand (no todos a la vez) — para Inngest
  // que procesa chunks pequeños.
  const startSitemapIdx = opts.cursor?.sitemap_idx ?? 0;
  let startUrlIdx = opts.cursor?.url_idx ?? 0;

  const items: ScrapedProperty[] = [];
  const seen = new Set<string>();
  let nextSitemapIdx = startSitemapIdx;
  let nextUrlIdx = startUrlIdx;
  let completedFullCycle = false;

  outer: for (let sIdx = startSitemapIdx; sIdx < childSitemaps.length; sIdx++) {
    const sitemapUrl = childSitemaps[sIdx];
    let urls: string[];
    try {
      urls = await collectListingUrls(sitemapUrl);
    } catch (err) {
      result.errors.push({
        url: sitemapUrl,
        stage: 'discovery',
        message: err instanceof Error ? err.message : String(err),
      });
      // Skip al siguiente sitemap.
      nextSitemapIdx = sIdx + 1;
      nextUrlIdx = 0;
      startUrlIdx = 0;
      continue;
    }
    result.discovered += urls.length;

    for (let uIdx = startUrlIdx; uIdx < urls.length; uIdx++) {
      if (items.length >= maxListings) {
        nextSitemapIdx = sIdx;
        nextUrlIdx = uIdx;
        break outer;
      }
      const url = urls[uIdx];
      if (seen.has(url)) continue;
      seen.add(url);

      let html: string;
      try {
        html = await fetchText(url, { portal: 'fincaraiz' });
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
        const item = parseFincaraizListing(url, html);
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
    // Terminamos este sitemap, avanzar al siguiente reseteando url_idx.
    nextSitemapIdx = sIdx + 1;
    nextUrlIdx = 0;
    startUrlIdx = 0;
  }

  // Si recorrimos todos los sitemaps sin llenar maxListings, completamos ciclo.
  // El cursor vuelve a {0, 0} para reiniciar (refresca data ya capturada).
  if (nextSitemapIdx >= childSitemaps.length) {
    nextSitemapIdx = 0;
    nextUrlIdx = 0;
    completedFullCycle = true;
  }

  // 3. Upsert idempotente.
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
  if (completedFullCycle) {
    // Marcamos en el message para que el caller lo registre.
    result.errors.push({
      url: '<cursor>',
      stage: 'discovery',
      message: 'INFO: completed full cycle, cursor reset to (0, 0)',
    });
  }

  return finalize(result, t0);
}

function finalize(result: ScrapeResult, t0: number): ScrapeResult {
  result.finishedAt = new Date().toISOString();
  result.durationMs = Date.now() - t0;
  return result;
}

async function discoverChildSitemaps(filters: {
  departments: string[];
  propertyTypes: string[];
  listingTypes: string[];
}): Promise<string[]> {
  const xml = await fetchXml(FINCARAIZ_SITEMAP_INDEX, { portal: 'fincaraiz' });
  const parser = new XMLParser({ ignoreAttributes: true });
  const data = parser.parse(xml);
  const raw = data?.sitemapindex?.sitemap;
  const list: Array<{ loc?: string }> = Array.isArray(raw) ? raw : raw ? [raw] : [];

  return list
    .map((s) => s?.loc)
    .filter((u): u is string => typeof u === 'string')
    .filter((u) => {
      // Naming: cde-sitemap-listings-{type}-en-{op}-{dept}.xml
      const matchesType = filters.propertyTypes.some((t) =>
        u.includes(`cde-sitemap-listings-${t}-en-`)
      );
      const matchesOp = filters.listingTypes.some((o) => u.includes(`-en-${o}-`));
      const matchesDept = filters.departments.some((d) => u.endsWith(`-${d}.xml`));
      return matchesType && matchesOp && matchesDept;
    });
}

async function collectListingUrls(sitemapUrl: string): Promise<string[]> {
  const xml = await fetchXml(sitemapUrl, { portal: 'fincaraiz' });
  const parser = new XMLParser({ ignoreAttributes: true });
  const data = parser.parse(xml);
  const raw = data?.urlset?.url;
  const list: Array<{ loc?: string; lastmod?: string }> = Array.isArray(raw)
    ? raw
    : raw
      ? [raw]
      : [];
  return list.map((u) => u?.loc).filter((u): u is string => typeof u === 'string');
}

// Parsea una página detalle. Retorna null si:
//   - es página de proyecto (multi-unit) — los descartamos por ahora
//   - el slug no matchea el patrón conocido
//   - falta precio (no hay nada útil que indexar sin precio)
//   - el property_type no mapea a la enum del schema
export function parseFincaraizListing(
  fetchedUrl: string,
  html: string
): ScrapedProperty | null {
  const $ = cheerio.load(html);

  // og:url tiene el URL canónico (puede diferir si hubo redirect).
  const ogUrl = $('meta[property="og:url"]').attr('content');
  const url = ogUrl ?? fetchedUrl;

  // Skip páginas de proyecto.
  if (url.includes('/proyectos-vivienda/')) return null;

  const slug = parseFincaraizSlug(url);
  if (!slug) return null;

  // Localizar JSON-LD action node.
  const action = findJsonLdAction($);

  // Title.
  const title = normalizeWhitespace(
    (action?.name as string | undefined) ??
      $('meta[property="og:title"]').attr('content') ??
      ''
  );

  // Price (estructurado o fallback a regex sobre HTML).
  let price: number | null = null;
  const priceSpec = action?.priceSpecification;
  if (priceSpec?.price != null) price = parseCOP(priceSpec.price);
  if (!price) {
    const m = html.match(/\$\s*([\d.,]{6,})/);
    if (m) price = parseCOP(m[1]);
  }
  if (!price) return null;

  // Description (JSON-LD descripción más completa que og:description).
  const description = normalizeWhitespace(
    (action?.description as string | undefined) ??
      $('meta[property="og:description"]').attr('content') ??
      ''
  );

  // Beds/baths/area: regex sobre og:description (tiene "3 habitaciones, 4 baños")
  // + descripción completa como fallback.
  const ogDesc = $('meta[property="og:description"]').attr('content') ?? '';
  const haystack = `${ogDesc} ${description}`;
  const bedrooms = parseInteger(matchOne(haystack, /(\d+)\s*habitacion/i));
  const bathrooms = parseInteger(
    matchOne(haystack, /(\d+)\s*ba(?:ñ|n)o/i)
  );
  const area_m2 = parseInteger(matchOne(haystack, /(\d+)\s*(?:m²|M2|m2|metros)/i));

  // City + neighborhood del slug.
  const city = canonicalCity(slug.city) ?? slug.city;
  const neighborhood = slug.neighborhood ? prettify(slug.neighborhood) : undefined;

  // Hero image: JSON-LD image o og:image.
  const heroImage =
    (typeof action?.image === 'string' ? action.image : undefined) ??
    $('meta[property="og:image"]').attr('content') ??
    '';
  const photos = heroImage ? [heroImage] : [];

  // Geo.
  const lat = action?.object?.geo?.latitude;
  const lng = action?.object?.geo?.longitude;

  // Contacto: el JSON-LD tiene un nodo `landlord` con name e image. Suele
  // ser una empresa (SAS/S.A.S.) pero a veces es nombre de persona.
  // Fincaraíz NO expone phone en JSON-LD; intentamos un regex sobre el
  // HTML por un atributo tel: o WhatsApp link como fallback.
  const landlord = action?.landlord;
  const landlordName =
    typeof landlord?.name === 'string' ? normalizeWhitespace(landlord.name) : undefined;
  const isCompany = landlordName ? looksLikeCompany(landlordName) : false;
  const contact_phone = extractPhoneFromHtml(html) ?? undefined;

  const propertyType: PropertyType | null = mapPropertyType(slug.type);
  if (!propertyType) return null;
  const listingType: ListingType = slug.op === 'venta' ? 'venta' : 'arriendo';

  return {
    source_portal: 'fincaraiz',
    source_url: url,
    title: title || `${propertyType} en ${city}`,
    description: description || undefined,
    price_cop: price,
    city,
    neighborhood: neighborhood || undefined,
    bedrooms: bedrooms ?? undefined,
    bathrooms: bathrooms ?? undefined,
    area_m2: area_m2 ?? undefined,
    property_type: propertyType,
    listing_type: listingType,
    photos,
    latitude: typeof lat === 'number' ? lat : undefined,
    longitude: typeof lng === 'number' ? lng : undefined,
    contact_name: landlordName,
    company_name: isCompany ? landlordName : undefined,
    contact_phone,
  };
}

// Heurística: el name parece empresa si tiene sufijo legal típico.
function looksLikeCompany(name: string): boolean {
  return /\b(SAS|S\.A\.S\.?|S\.A\.|LTDA|S\.?A\.?|INMOBILIARIA|CONSTRUCTOR|GRUPO)\b/i.test(name);
}

// Extrae phone del HTML: primero tel: link, luego un wa.me/{number}.
function extractPhoneFromHtml(html: string): string | null {
  // tel: link
  const tel = html.match(/href="tel:\+?(\d[\d\s-]{6,})"/);
  if (tel) {
    const digits = tel[1].replace(/\D/g, '');
    if (digits.length >= 7) {
      return digits.startsWith('57') ? digits : `57${digits}`;
    }
  }
  // wa.me link
  const wa = html.match(/wa\.me\/(\d{10,15})/);
  if (wa) return wa[1];
  return null;
}

// Itera blocks JSON-LD y devuelve el primero que sea un Action sobre real estate.
function findJsonLdAction($: cheerio.CheerioAPI): any | null {
  let result: any = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (result) return;
    const raw = $(el).contents().text();
    try {
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const it of items) {
        const t = it?.['@type'];
        if (t === 'RentAction' || t === 'SaleAction' || t === 'BuyAction') {
          result = it;
          return;
        }
      }
    } catch {
      // skip malformed JSON-LD
    }
  });
  return result;
}

function matchOne(s: string, re: RegExp): string | null {
  const m = s.match(re);
  return m ? m[1] : null;
}

function prettify(slugPart: string): string {
  return slugPart
    .split('-')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

interface SlugInfo {
  type: string;
  op: 'venta' | 'arriendo';
  neighborhood?: string;
  city: string;
  id: string;
}

// Pattern: https://www.fincaraiz.com.co/{slug}/{numeric-id}
// donde slug = "{name?}-{type}-en-{op}-en-{hood-slug?}-{city}".
export function parseFincaraizSlug(url: string): SlugInfo | null {
  const m = url.match(/\/([a-z0-9-]+)\/(\d+)\/?$/);
  if (!m) return null;
  const slug = m[1];
  const id = m[2];

  // Encontrar tipo (último match para evitar prefijos como "casa-de-...").
  let typeIdx = -1;
  let type = '';
  for (const t of SLUG_TYPES) {
    const idx = slug.lastIndexOf(`${t}-en-`);
    if (idx > typeIdx) {
      typeIdx = idx;
      type = t;
    }
  }
  if (typeIdx < 0) return null;

  const afterType = slug.slice(typeIdx + type.length + 4); // +4 = "-en-"
  const opMatch = afterType.match(
    /^(venta|alquiler-temporal|alquiler|arriendo-temporal|arriendo)-en-(.+)$/
  );
  if (!opMatch) return null;

  const opRaw = opMatch[1];
  const op: 'venta' | 'arriendo' =
    opRaw.includes('alquiler') || opRaw.includes('arriendo') ? 'arriendo' : 'venta';

  const hoodAndCity = opMatch[2];
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
