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

// Slugs verificados en homepage recon. Los demás puede que no existan.
const DEFAULT_LOCATIONS = [
  'bogota-d-c-colombia',
  'medellin-antioquia',
  'cali-valle-del-cauca',
  'barranquilla-atlantico',
  'cartagena-bolivar',
];

const DEFAULT_TYPES: ProperatiOptions['propertyTypes'] = [
  'apartamento',
  'casa',
  'apartaestudio',
];
const DEFAULT_OPS: ProperatiOptions['listingTypes'] = ['venta', 'arriendo'];

const MAX_PAGES_PER_COMBO = 5; // 32 × 5 = 160 listings/combo, suficiente

export interface ProperatiOptions {
  maxListings?: number;
  /** Slugs Properati ej: 'bogota-d-c-colombia'. */
  locations?: string[];
  propertyTypes?: Array<'apartamento' | 'casa' | 'apartaestudio' | 'oficina' | 'lote'>;
  listingTypes?: Array<'venta' | 'arriendo'>;
  /** Páginas máximas por combo. Default 5 = 160 listings/combo. */
  maxPagesPerCombo?: number;
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

  outer: for (const combo of combos) {
    for (let page = 1; page <= maxPagesPerCombo; page++) {
      if (items.length >= maxListings) break outer;

      const url = page === 1
        ? `${PROPERATI_BASE}/s/${combo.location}/${combo.type}/${combo.op}`
        : `${PROPERATI_BASE}/s/${combo.location}/${combo.type}/${combo.op}/${page}`;

      let html: string;
      try {
        html = await fetchText(url, { userAgent: PROPERATI_UA });
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
