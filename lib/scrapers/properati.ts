// lib/scrapers/properati.ts
// Scraper de Properati — strategy SEARCH-ONLY + PAGINACIÓN.
// Cada search page (32 cards) tiene los datos completos via data-test
// selectors. Pagination via path: /s/{loc}/{type}/{op}/{N}.
//
// Recon Día 1+4:
// - UA "BuscaProp Colombia (+...)" → 403. Browser UA → 200. Combinamos:
//   "Mozilla/5.0 ... BuscaProp/1.0 (+contacto@...)" para identificarnos.
// - Search URL: /s/{location-slug}/{type}/{op}[/{page}]
//   ej: /s/bogota-d-c-colombia/apartamento/venta/2  (página 2)
// - Cards: <article class="snippet" data-idanuncio="UUID" data-url="...">
//   con data-test selectors estables.
// - 32 cards por página. ~268 páginas para Bogotá apto venta (~8.5K total).

import * as cheerio from 'cheerio';
import { fetchText } from './shared/http';
import { upsertBatch } from './shared/upsert';
import {
  canonicalCity,
  isValidColombiaCoord,
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

const PROPERATI_BASE = 'https://www.properati.com.co';

// UA híbrido browser-like + identificador BuscaProp.
export const PROPERATI_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 BuscaProp/1.0 ' +
  '(+contacto@buscaprop.co)';

// Ubicaciones de Properati. Todas validadas vía fetch real (apartamento/venta
// devuelve cards). OJO: el slug NO es uniforme — adivinar falla seguido
// (bucaramanga-santander, pereira-risaralda, caldas-colombia, santander-colombia
// dan 404). Los slugs a nivel DEPARTAMENTO ({depto}-colombia) capturan el
// long-tail de municipios, no solo capitales. Solapan con las ciudades (Medellín
// ⊂ Antioquia) pero upsert deduplica el solape (updates, no duplicados).
const DEFAULT_LOCATIONS = [
  // Ciudades / D.C. (capitales con paginación profunda propia).
  'bogota-d-c-colombia',
  'medellin-antioquia',
  'cali-valle-del-cauca',
  'barranquilla-atlantico',
  'cartagena-bolivar',
  'manizales-caldas', // Caldas no tiene slug a nivel depto (caldas-colombia → 404).
  'bello-antioquia',
  // Departamentos con inventario (19 validados de 32). Cobertura nacional.
  'antioquia-colombia',
  'atlantico-colombia',
  'bolivar-colombia',
  'casanare-colombia',
  'cauca-colombia',
  'cesar-colombia',
  'cordoba-colombia',
  'cundinamarca-colombia',
  'guainia-colombia',
  'guaviare-colombia',
  'huila-colombia',
  'la-guajira-colombia',
  'magdalena-colombia',
  'meta-colombia',
  'norte-de-santander-colombia',
  'quindio-colombia',
  'risaralda-colombia',
  'tolima-colombia',
  'valle-del-cauca-colombia',
];

const DEFAULT_TYPES: ProperatiOptions['propertyTypes'] = [
  'apartamento',
  'casa',
  'apartaestudio',
  'oficina',
];
const DEFAULT_OPS: ProperatiOptions['listingTypes'] = ['venta', 'arriendo'];

// 32 listings/página. Subido 5→10 (320/combo) para que el full-run de GitHub
// Actions (maxListings=1500) llegue más profundo en combos con mucho inventario.
// NO afecta los ticks de Inngest (los topa TICK_MAX=35 ≈ 2 páginas) ni sube el
// total de requests del full-run (maxListings=1500 ya es el tope global).
const MAX_PAGES_PER_COMBO = 10;

export interface ProperatiOptions {
  maxListings?: number;
  /** Slugs Properati ej: 'bogota-d-c-colombia'. */
  locations?: string[];
  propertyTypes?: Array<'apartamento' | 'casa' | 'apartaestudio' | 'oficina' | 'lote'>;
  listingTypes?: Array<'venta' | 'arriendo'>;
  /** Páginas máximas por combo. Default 5 = 160 listings/combo. */
  maxPagesPerCombo?: number;
  /**
   * Si true, fetch detail page por cada listing para extraer coordinates
   * (Properati no las expone en search). +1 request por listing (~500KB c/u),
   * pero CRÍTICO para Phase 10 (IDECA enrichment).
   * Default true. Pasar false en tests / debugging local.
   */
  enrichWithDetail?: boolean;
  /** Cursor incremental — combo_idx en el array de combos. */
  cursor?: { combo_idx?: number };
}

// ============================================================================
// SCRAPER PRINCIPAL
// ============================================================================

export async function scrapeProperati(
  opts: ProperatiOptions = {}
): Promise<ScrapeResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const result: ScrapeResult = {
    portal: 'properati',
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

  const maxListings = opts.maxListings ?? 200;
  const locations = opts.locations ?? DEFAULT_LOCATIONS;
  const propertyTypes = opts.propertyTypes ?? DEFAULT_TYPES!;
  const listingTypes = opts.listingTypes ?? DEFAULT_OPS!;
  const maxPagesPerCombo = opts.maxPagesPerCombo ?? MAX_PAGES_PER_COMBO;

  // Iteración: location-first para diversidad geográfica desde el primer combo.
  const combos: Array<{ location: string; type: string; op: string }> = [];
  for (const op of listingTypes) {
    for (const type of propertyTypes) {
      for (const loc of locations) {
        combos.push({ location: loc, type, op });
      }
    }
  }

  const items: ScrapedProperty[] = [];
  const seenUrls = new Set<string>();

  const startComboIdx = opts.cursor?.combo_idx ?? 0;
  let nextComboIdx = startComboIdx;

  outer: for (let cIdx = startComboIdx; cIdx < combos.length; cIdx++) {
    const combo = combos[cIdx];
    nextComboIdx = cIdx + 1;
    for (let page = 1; page <= maxPagesPerCombo; page++) {
      if (items.length >= maxListings) {
        nextComboIdx = cIdx; // mantenemos en el mismo combo si no terminamos páginas
        break outer;
      }

      const url = page === 1
        ? `${PROPERATI_BASE}/s/${combo.location}/${combo.type}/${combo.op}`
        : `${PROPERATI_BASE}/s/${combo.location}/${combo.type}/${combo.op}/${page}`;

      let html: string;
      try {
        html = await fetchText(url, { userAgent: PROPERATI_UA, portal: 'properati' });
        result.fetched++;
      } catch (err) {
        result.errors.push({
          url,
          stage: 'fetch',
          message: err instanceof Error ? err.message : String(err),
        });
        // 404 esperado al pasar el último page → break inner loop.
        if (err instanceof Error && err.message.includes('404')) break;
        continue;
      }

      const cards = parseProperatiSearchPage(url, html, {
        propertyType: combo.type,
        listingType: combo.op,
      });
      result.discovered += cards.length;

      if (cards.length === 0) break; // sin resultados → no hay más páginas

      let addedThisPage = 0;
      for (const card of cards) {
        if (items.length >= maxListings) break outer;
        if (seenUrls.has(card.source_url)) continue;
        seenUrls.add(card.source_url);
        items.push(card);
        result.parsed++;
        addedThisPage++;
      }
      // Si no agregamos nada nuevo (todas duplicadas), abandonar este combo.
      if (addedThisPage === 0) break;
    }
  }

  // Cursor: si terminamos todos los combos sin llenar maxListings, reset.
  if (nextComboIdx >= combos.length) nextComboIdx = 0;
  result.nextCursor = { last_combo_idx: nextComboIdx };

  // Enriquecer con detail-fetch para extraer coords (no están en search).
  // Default true desde Phase 10 — sin coords no podemos enriquecer con IDECA.
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
// PARSER DE SEARCH PAGE
// ============================================================================

interface CardContext {
  /** type del search URL: 'apartamento'|'casa'|... */
  propertyType: string;
  /** op del search URL: 'venta'|'arriendo' */
  listingType: string;
}

export function parseProperatiSearchPage(
  searchUrl: string,
  html: string,
  ctx: CardContext
): ScrapedProperty[] {
  const $ = cheerio.load(html);
  const out: ScrapedProperty[] = [];

  $('article.snippet[data-idanuncio]').each((_, el) => {
    try {
      const mapped = mapProperatiCard($, $(el), searchUrl, ctx);
      if (mapped) out.push(mapped);
    } catch {
      // skip card malformada
    }
  });

  return out;
}

export function mapProperatiCard(
  $: cheerio.CheerioAPI,
  $card: ReturnType<cheerio.CheerioAPI>,
  searchUrl: string,
  ctx: CardContext
): ScrapedProperty | null {
  // URL única del listing. data-url debería estar en el article.
  const dataUrl = $card.attr('data-url');
  if (!dataUrl) return null;

  // Texto de cada data-test. textOf() colapsa whitespace.
  const title = textOf($card, '[data-test="snippet__title"]');
  const priceText = textOf($card, '[data-test="snippet__price"]');
  const locationText = textOf($card, '[data-test="snippet__location"]');
  const bedroomsText = textOf($card, '[data-test="bedrooms-value"]');
  const bathroomsText = textOf($card, '[data-test="full-bathrooms-value"]');
  const areaText = textOf($card, '[data-test="area-value"]');

  // Precio: "$ 1.350.000.000" o "Desde $ 509.430.000" (project)
  const price = parseCOP(priceText);
  if (!price) return null;

  // Ranges en projects: "1 - 3 habitaciones" → tomar el LOW (más conservador).
  const bedrooms = firstInt(bedroomsText);
  const bathrooms = firstInt(bathroomsText);
  const area_m2 = firstInt(areaText);

  // Property type: del search URL (ya filtrado por la query).
  const propertyType = mapPropertyType(ctx.propertyType);
  if (!propertyType) return null;

  // Listing type: del search URL.
  const listingType: ListingType = ctx.listingType === 'venta' ? 'venta' : 'arriendo';

  // Location: "Chapinero, Zona X, Bogotá D.C, Cundinamarca"
  // Tokens separados por coma. Penúltimo = ciudad ("Bogotá D.C"), primero = barrio.
  const tokens = locationText.split(',').map((t) => t.trim()).filter(Boolean);
  let cityRaw = '';
  let neighborhood: string | undefined;
  if (tokens.length >= 2) {
    cityRaw = tokens[tokens.length - 2];
    neighborhood = tokens[0];
  } else if (tokens.length === 1) {
    cityRaw = tokens[0];
  }
  const city = canonicalCity(cityRaw) ?? cityRaw ?? 'Bogotá';

  // Photos: tomar las primeras 1-3 de los slides.
  const photos: string[] = [];
  $card.find('img.swiper-no-swiping, img.swiper-lazy').each((_, img) => {
    const src = $(img).attr('src') ?? $(img).attr('data-src');
    if (src && photos.length < 3 && !photos.includes(src)) {
      photos.push(src);
    }
  });

  // Contacto: nombre/inmobiliaria visible en el card. Phone NO está en
  // search (está detrás de un click "Mostrar teléfono" que requiere JS).
  const agentName = textOf($card, '[data-test="agency-name"]');
  // Heurística: si el nombre tiene sufijo legal o palabras tipo "Inmobiliaria",
  // tratarlo como empresa. Si es nombre de persona, tratarlo como contact_name.
  const isCompany = agentName ? looksLikeCompany(agentName) : false;

  return {
    source_portal: 'properati',
    source_url: dataUrl,
    title: normalizeWhitespace(title) || `${propertyType} en ${city}`,
    description: undefined, // no descripción en search card
    price_cop: price,
    city,
    neighborhood: neighborhood && neighborhood !== city ? neighborhood : undefined,
    bedrooms: bedrooms ?? undefined,
    bathrooms: bathrooms ?? undefined,
    area_m2: area_m2 ?? undefined,
    property_type: propertyType,
    listing_type: listingType,
    photos,
    latitude: undefined,
    longitude: undefined,
    contact_name: !isCompany && agentName ? agentName : undefined,
    company_name: isCompany ? agentName : undefined,
    // Phone no disponible en search-only.
    contact_phone: undefined,
  };
}

function looksLikeCompany(name: string): boolean {
  return /\b(SAS|S\.A\.S\.?|LTDA|S\.A\.|INMOBILIARIA|CONSTRUCTORA?|GRUPO|REALTY|RESORTS|CASAS|CIA)\b/i.test(name);
}

function textOf($card: ReturnType<cheerio.CheerioAPI>, selector: string): string {
  const $el = $card.find(selector).first();
  if (!$el.length) return '';
  return $el.text().replace(/\s+/g, ' ').trim();
}

// "2 habitaciones" → 2  |  "1 - 3 habitaciones" → 1  |  "Desde 38 m²" → 38
// Tomamos el primer entero que aparece.
function firstInt(s: string): number | null {
  if (!s) return null;
  const n = parseInteger(s);
  return n != null && n >= 0 ? n : null;
}

// ============================================================================
// ENRICH WITH DETAIL — fetch /detalle/{id} para extraer coords
// ============================================================================
//
// Properati no expone lat/lng en el search/listing page (cards). Sí están en
// /detalle/{id} dentro de un script inline con un objeto JS literal:
//
//   adLocationData: {
//     coordinates: {
//       latitude: "4.699150899999999",
//       longitude: "-74.0518031"
//     },
//     ...
//   }
//
// Patrón validado en Phase 10 probe (2 URLs reales). Las coords vienen como
// strings — hacemos parseFloat. Validamos contra bounding box de Colombia.

const PROPERATI_COORDS_RE =
  /latitude:\s*"([0-9.-]+)"\s*,\s*longitude:\s*"([0-9.-]+)"/;

export function parseCoordsFromHtml(
  html: string
): { latitude: number; longitude: number } | null {
  const m = html.match(PROPERATI_COORDS_RE);
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lng = parseFloat(m[2]);
  if (!isValidColombiaCoord(lat, lng)) return null;
  return { latitude: lat, longitude: lng };
}

export async function enrichWithDetail(item: ScrapedProperty): Promise<void> {
  // Solo necesitamos el HTML para regex de coords. No parseamos cheerio
  // porque el script con coords NO es elemento DOM — es contenido de un
  // <script> inline.
  const html = await fetchText(item.source_url, { userAgent: PROPERATI_UA, portal: 'properati' });
  const coords = parseCoordsFromHtml(html);
  if (coords) {
    item.latitude = coords.latitude;
    item.longitude = coords.longitude;
  } else {
    // No es un error duro — algunos listings pueden no tener mapa público.
    // Logueamos solo si resulta útil para diagnóstico (modo verbose podría
    // activarlo).
  }
}
