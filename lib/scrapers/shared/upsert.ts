// lib/scrapers/shared/upsert.ts
// Upsert idempotente contra Supabase. Una corrida del mismo scraper dos
// veces no debe crear duplicados; debe actualizar la fila existente.
//
// IMPORTANTE: este archivo se ejecuta server-side (scrapers / cron job).
// Usa la SERVICE_ROLE_KEY para saltarse RLS.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { dedupeHash } from './dedupe';
import { canonicalCity, cleanLeftoverNeighborhood } from './normalize';
import type { ScrapedProperty } from './types';

let cachedClient: SupabaseClient | null = null;
function getServerClient(): SupabaseClient {
  if (cachedClient) return cachedClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'upsert.ts requiere NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY ' +
        'definidas en .env.local (lado server, NUNCA exponer al cliente)'
    );
  }
  cachedClient = createClient(url, key, { auth: { persistSession: false } });
  return cachedClient;
}

// Detecta qué columnas opcionales están disponibles en la BD. Las migraciones
// 003, 004, 016 agregan distintos campos; los scrapers degradan gracefully si
// alguna no está aplicada. Cache por proceso para no sniffer en cada upsert.
const OPTIONAL_COLUMNS = [
  'dedup_hash',
  'contact_name',
  'contact_phone',
  'company_name',
  'source_lastmod', // migration 016 — cache por lastmod del sitemap
] as const;
type OptionalCol = (typeof OPTIONAL_COLUMNS)[number];

let availableColumns: Set<OptionalCol> | null = null;

async function detectAvailableColumns(supabase: SupabaseClient): Promise<Set<OptionalCol>> {
  if (availableColumns) return availableColumns;
  // Probar todas a la vez (rápido si todas existen).
  const allCols = OPTIONAL_COLUMNS.join(',');
  const { error } = await supabase.from('properties').select(allCols).limit(1);
  if (!error) {
    availableColumns = new Set(OPTIONAL_COLUMNS);
    return availableColumns;
  }
  // Alguna falta → testear individualmente para identificar cuáles.
  const found = new Set<OptionalCol>();
  for (const col of OPTIONAL_COLUMNS) {
    const { error: e } = await supabase.from('properties').select(col).limit(1);
    if (!e) found.add(col);
  }
  availableColumns = found;

  const missing = OPTIONAL_COLUMNS.filter((c) => !found.has(c));
  if (missing.length > 0) {
    const m = missing.join(', ');
    const migs = [];
    if (missing.includes('dedup_hash')) migs.push('003_add_dedup_hash.sql');
    if (missing.some((c) => c === 'contact_name' || c === 'contact_phone' || c === 'company_name'))
      migs.push('004_add_contact_fields.sql');
    if (missing.includes('source_lastmod')) migs.push('016_scrape_observability.sql');
    console.warn(
      `⚠️  Columnas opcionales no disponibles: ${m}. ` +
        `Ejecutar en Supabase SQL Editor: ${migs.join(', ')}`
    );
  }
  return availableColumns;
}

export interface UpsertOutcome {
  inserted: boolean; // true si fue INSERT, false si UPDATE
  duplicateOf?: string; // canonical_id si encontramos un match cross-portal
  id: string; // id final en la tabla properties
}

export async function upsertProperty(p: ScrapedProperty): Promise<UpsertOutcome> {
  const supabase = getServerClient();
  const available = await detectAvailableColumns(supabase);

  // Normalización central, defense-in-depth. Aunque un scraper individual no
  // llame a canonicalCity (ej. fincaraiz cuando saca city='vicente' del slug),
  // aquí se corrige antes de tocar la BD. Idempotente: si ya viene canonical,
  // canonicalCity() lo devuelve igual.
  const normalizedCity = canonicalCity(p.city) ?? p.city;
  const normalizedNeighborhood = cleanLeftoverNeighborhood(p.neighborhood);

  let canonicalId: string | null = null;
  let hash: string | null = null;
  if (available.has('dedup_hash')) {
    hash = dedupeHash(p);
    const { data: existing } = await supabase
      .from('properties')
      .select('id, source_portal, is_duplicate')
      .eq('dedup_hash', hash)
      .neq('source_portal', p.source_portal)
      .eq('is_duplicate', false)
      .limit(1)
      .maybeSingle();
    canonicalId = existing?.id ?? null;
  }
  const isDuplicate = !!canonicalId;

  // Read-before-write: si la propiedad ya existe (mismo portal + URL),
  // necesitamos el price_cop anterior para detectar cambio y armar el delta
  // del snapshot histórico. Una sola query por upsert — no encarece mucho.
  const { data: prevRow } = await supabase
    .from('properties')
    .select('id, price_cop')
    .eq('source_portal', p.source_portal)
    .eq('source_url', p.source_url)
    .maybeSingle();
  const prevPriceCop: number | null = prevRow?.price_cop ?? null;

  const row: Record<string, unknown> = {
    source_portal: p.source_portal,
    source_url: p.source_url,
    title: p.title,
    description: p.description ?? null,
    price_cop: p.price_cop,
    city: normalizedCity,
    neighborhood: normalizedNeighborhood,
    bedrooms: p.bedrooms ?? null,
    bathrooms: p.bathrooms ?? null,
    area_m2: p.area_m2 ?? null,
    property_type: p.property_type,
    listing_type: p.listing_type,
    photos: p.photos ?? [],
    latitude: p.latitude ?? null,
    longitude: p.longitude ?? null,
    is_duplicate: isDuplicate,
    canonical_id: canonicalId,
    scraped_at: p.scraped_at ?? new Date().toISOString(),
  };
  if (available.has('dedup_hash') && hash) row.dedup_hash = hash;
  if (available.has('contact_name')) row.contact_name = p.contact_name ?? null;
  if (available.has('contact_phone')) row.contact_phone = p.contact_phone ?? null;
  if (available.has('company_name')) row.company_name = p.company_name ?? null;
  // source_lastmod: solo lo escribimos si el scraper lo provee. Si no viene,
  // dejamos lo que ya estaba (no sobrescribir con null en cada UPDATE).
  if (available.has('source_lastmod') && p.source_lastmod !== undefined) {
    row.source_lastmod = p.source_lastmod;
  }

  const { data: upserted, error } = await supabase
    .from('properties')
    .upsert(row, { onConflict: 'source_portal,source_url', ignoreDuplicates: false })
    .select('id, created_at, updated_at')
    .single();

  if (error) throw error;
  if (!upserted) throw new Error('upsert returned no data');

  // INSERT: created_at == updated_at; UPDATE: updated_at > created_at.
  const inserted = upserted.created_at === upserted.updated_at;

  // ─── Histórico de precios ────────────────────────────────────────────────
  // Insertamos un snapshot SOLO si:
  //   a) Es la primera vez que vemos esta propiedad (inserted=true), o
  //   b) El precio cambió respecto al anterior.
  // Si no hay cambio, no insertamos (se reduce 95% de storage en operación
  // estable). La timeline se reconstruye con LAG() en SQL.
  // El insert es best-effort: si la tabla no existe (migration 008 no
  // aplicada), logueamos warning y NO rompemos el upsert principal.
  const priceChanged = prevPriceCop !== null && prevPriceCop !== p.price_cop;
  const shouldSnapshot = inserted || priceChanged;

  if (shouldSnapshot) {
    const deltaCop = prevPriceCop !== null ? p.price_cop - prevPriceCop : null;
    const deltaPct =
      prevPriceCop !== null && prevPriceCop > 0
        ? Math.round(((p.price_cop - prevPriceCop) / prevPriceCop) * 10000) / 100
        : null;

    const { error: histErr } = await supabase.from('property_history').insert({
      property_id: upserted.id,
      price_cop: p.price_cop,
      scraped_at: p.scraped_at ?? new Date().toISOString(),
      source_portal: p.source_portal,
      status: 'active',
      delta_cop: deltaCop,
      delta_pct: deltaPct,
    });
    if (histErr) {
      // No rompemos el upsert por un error de histórico. Logueamos para que
      // se vea claro en producción.
      const msg = histErr.message ?? '';
      const isMissing =
        /does not exist/i.test(msg) || /could not find.*table/i.test(msg);
      if (isMissing) {
        // Solo loguear UNA vez por proceso para no spamear.
        if (!warnedHistoryMissing) {
          console.warn(
            '⚠️  Tabla property_history no existe. Aplicar migration 008. ' +
              'Los snapshots de histórico se están descartando.'
          );
          warnedHistoryMissing = true;
        }
      } else {
        console.warn(`[property_history] insert falló: ${formatError(histErr)}`);
      }
    }
  }

  return {
    inserted,
    duplicateOf: canonicalId ?? undefined,
    id: upserted.id,
  };
}

// Flag de proceso para no spamear el log de "tabla no existe" en cada upsert.
let warnedHistoryMissing = false;

// Convierte errores opacos de Supabase ({code, details, hint, message}) o
// Error nativos a un string informativo. Sin esto, JSON.stringify de un
// PostgrestError emite "[object Object]".
function formatError(e: unknown): string {
  if (!e) return 'unknown error';
  if (e instanceof Error) return e.message;
  if (typeof e === 'object') {
    const o = e as Record<string, unknown>;
    const parts: string[] = [];
    if (o.code) parts.push(`code=${o.code}`);
    if (o.message) parts.push(String(o.message));
    if (o.details) parts.push(`details=${o.details}`);
    if (o.hint) parts.push(`hint=${o.hint}`);
    return parts.length ? parts.join(' | ') : JSON.stringify(o);
  }
  return String(e);
}

/**
 * Sweep post-scrape: marca como 'delisted' las propiedades del portal que
 * NO aparecieron en el scrape recién terminado. Heurística: si una propiedad
 * tiene `scraped_at` más viejo que el threshold (default 7 días), asumimos que
 * salió del portal (vendida/retirada/expirada).
 *
 * No mueve filas — solo agrega un snapshot 'delisted' a property_history.
 * La fila en `properties` se queda como estaba (para que sigamos pudiendo
 * mostrar el detalle si alguien tiene el link).
 *
 * Idempotente: si una propiedad ya tiene su último snapshot como 'delisted',
 * no agregamos otro.
 */
export async function markDelistedForPortal(
  portal: ScrapedProperty['source_portal'],
  options: { stalenessDays?: number } = {}
): Promise<{ markedDelisted: number; alreadyDelisted: number }> {
  const stalenessDays = options.stalenessDays ?? 7;
  const supabase = getServerClient();
  const cutoff = new Date(Date.now() - stalenessDays * 24 * 60 * 60 * 1000).toISOString();

  // 1. Encontrar propiedades del portal con scraped_at viejo.
  const { data: stale, error: staleErr } = await supabase
    .from('properties')
    .select('id, price_cop')
    .eq('source_portal', portal)
    .lt('scraped_at', cutoff);
  if (staleErr) {
    console.warn(`[markDelisted] query stale failed: ${formatError(staleErr)}`);
    return { markedDelisted: 0, alreadyDelisted: 0 };
  }
  if (!stale || stale.length === 0) return { markedDelisted: 0, alreadyDelisted: 0 };

  // 2. Para cada una, mirar el último snapshot. Si ya es 'delisted', skip.
  let markedDelisted = 0;
  let alreadyDelisted = 0;
  const now = new Date().toISOString();

  for (const prop of stale) {
    const { data: lastSnap, error: snapErr } = await supabase
      .from('property_history')
      .select('status')
      .eq('property_id', prop.id)
      .order('scraped_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (snapErr) {
      const msg = snapErr.message ?? '';
      if (/does not exist/i.test(msg) || /could not find.*table/i.test(msg)) {
        return { markedDelisted: 0, alreadyDelisted: 0 };
      }
      continue;
    }
    if (lastSnap?.status === 'delisted') {
      alreadyDelisted++;
      continue;
    }
    const { error: insertErr } = await supabase.from('property_history').insert({
      property_id: prop.id,
      price_cop: prop.price_cop,
      scraped_at: now,
      source_portal: portal,
      status: 'delisted',
      delta_cop: null,
      delta_pct: null,
    });
    if (insertErr) {
      console.warn(`[markDelisted] insert failed: ${formatError(insertErr)}`);
      continue;
    }
    markedDelisted++;
  }
  return { markedDelisted, alreadyDelisted };
}

// Batch helper para procesar arrays de scraped properties.
export async function upsertBatch(items: ScrapedProperty[]): Promise<{
  inserted: number;
  updated: number;
  duplicates: number;
  errors: Array<{ url: string; error: string }>;
}> {
  let inserted = 0,
    updated = 0,
    duplicates = 0;
  const errors: Array<{ url: string; error: string }> = [];

  for (const item of items) {
    try {
      const r = await upsertProperty(item);
      if (r.inserted) inserted++;
      else updated++;
      if (r.duplicateOf) duplicates++;
    } catch (e) {
      errors.push({ url: item.source_url, error: formatError(e) });
    }
  }

  return { inserted, updated, duplicates, errors };
}
