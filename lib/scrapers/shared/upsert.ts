// lib/scrapers/shared/upsert.ts
// Upsert idempotente contra Supabase. Una corrida del mismo scraper dos
// veces no debe crear duplicados; debe actualizar la fila existente.
//
// IMPORTANTE: este archivo se ejecuta server-side (scrapers / cron job).
// Usa la SERVICE_ROLE_KEY para saltarse RLS.

import { createClient } from '@supabase/supabase-js';
import { dedupeHash } from './dedupe';
import type { ScrapedProperty } from './types';

function getServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'upsert.ts requiere NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY ' +
        'definidas en .env.local (lado server, NUNCA exponer al cliente)'
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export interface UpsertOutcome {
  inserted: boolean; // true si fue INSERT, false si UPDATE
  duplicateOf?: string; // canonical_id si encontramos un match cross-portal
  id: string; // id final en la tabla properties
}

export async function upsertProperty(p: ScrapedProperty): Promise<UpsertOutcome> {
  const supabase = getServerClient();
  const hash = dedupeHash(p);

  // 1. Buscar canonical existente por hash (excluyendo este portal).
  //    Si hay match en otro portal → marcar como duplicate.
  const { data: existing } = await supabase
    .from('properties')
    .select('id, source_portal, is_duplicate')
    .eq('dedup_hash', hash)
    .neq('source_portal', p.source_portal)
    .eq('is_duplicate', false)
    .limit(1)
    .maybeSingle();

  const canonicalId = existing?.id ?? null;
  const isDuplicate = !!canonicalId;

  // 2. Upsert con la unique constraint (source_portal, source_url).
  //    Postgres "ON CONFLICT" lo maneja Supabase con onConflict.
  const row = {
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
    dedup_hash: hash,
    scraped_at: p.scraped_at ?? new Date().toISOString(),
  };

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
      errors.push({
        url: item.source_url,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { inserted, updated, duplicates, errors };
}
