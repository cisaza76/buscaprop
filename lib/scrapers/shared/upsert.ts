// lib/scrapers/shared/upsert.ts
// Upsert idempotente contra Supabase. Una corrida del mismo scraper dos
// veces no debe crear duplicados; debe actualizar la fila existente.
//
// IMPORTANTE: este archivo se ejecuta server-side (scrapers / cron job).
// Usa la SERVICE_ROLE_KEY para saltarse RLS.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { dedupeHash } from './dedupe';
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
// 003 y 004 agregan distintos campos; los scrapers degradan gracefully si
// alguna no está aplicada. Cache por proceso para no sniffer en cada upsert.
const OPTIONAL_COLUMNS = ['dedup_hash', 'contact_name', 'contact_phone', 'company_name'] as const;
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

  const row: Record<string, unknown> = {
    source_portal: p.source_portal,
    source_url: p.source_url,
    title: p.title,
    description: p.description ?? null,
    price_cop: p.price_cop,
    city: p.city,
    neighborhood: p.neighborhood ?? null,
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

  const { data: upserted, error } = await supabase
    .from('properties')
    .upsert(row, { onConflict: 'source_portal,source_url', ignoreDuplicates: false })
    .select('id, created_at, updated_at')
    .single();

  if (error) throw error;
  if (!upserted) throw new Error('upsert returned no data');

  // INSERT: created_at == updated_at; UPDATE: updated_at > created_at.
  const inserted = upserted.created_at === upserted.updated_at;

  return {
    inserted,
    duplicateOf: canonicalId ?? undefined,
    id: upserted.id,
  };
}

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
