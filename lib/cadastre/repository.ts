// lib/cadastre/repository.ts
// Lectura/escritura de property_cadastral. Service-role only — server-side.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { queryIDECAByCoords, type IDECAQueryResult } from './ideca';

let cachedClient: SupabaseClient | null = null;
function getClient(): SupabaseClient {
  if (cachedClient) return cachedClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Faltan SUPABASE_URL / SERVICE_ROLE_KEY');
  cachedClient = createClient(url, key, { auth: { persistSession: false } });
  return cachedClient;
}

export interface PropertyCadastral {
  property_id: string;
  status: 'verified' | 'not_found' | 'error';
  lot_code: string | null;
  manzana_code: string | null;
  sector_code: string | null;
  sector_name: string | null;
  predio_units: number | null;
  lot_area_m2: number | null;
  soil_classification: number | null;
  soil_admin_act: string | null;
  chip: string | null;
  validated_at: string;
  error_message: string | null;
}

/** Lectura: cadastral data de una propiedad (null si no enriquecida aún). */
export async function getCadastralForProperty(
  propertyId: string
): Promise<PropertyCadastral | null> {
  const sb = getClient();
  const { data, error } = await sb
    .from('property_cadastral')
    .select('*')
    .eq('property_id', propertyId)
    .maybeSingle();
  if (error) {
    const msg = error.message ?? '';
    if (/does not exist/i.test(msg) || /could not find.*table/i.test(msg)) return null;
    throw new Error(`getCadastralForProperty failed: ${msg}`);
  }
  return (data as PropertyCadastral | null) ?? null;
}

/**
 * Enrichment de UNA propiedad: query IDECA + upsert. Idempotente.
 * Retorna el row resultante. Best-effort sobre la persistencia: si la tabla
 * no existe (migration 010 no aplicada), devuelve el resultado pero no
 * persiste — log warn y sigue.
 */
export async function enrichProperty(args: {
  propertyId: string;
  latitude: number;
  longitude: number;
}): Promise<IDECAQueryResult & { persisted: boolean }> {
  const result = await queryIDECAByCoords(args.latitude, args.longitude);

  const sb = getClient();
  const row = {
    property_id: args.propertyId,
    status: result.status,
    lot_code: result.lot_code,
    manzana_code: result.manzana_code,
    sector_code: result.sector_code,
    sector_name: result.sector_name,
    predio_units: result.predio_units,
    lot_area_m2: result.lot_area_m2,
    soil_classification: result.soil_classification,
    soil_admin_act: result.soil_admin_act,
    chip: null, // reservado, no poblamos hoy
    validated_at: new Date().toISOString(),
    error_message: result.error_message ?? null,
  };

  const { error } = await sb
    .from('property_cadastral')
    .upsert(row, { onConflict: 'property_id' });

  let persisted = true;
  if (error) {
    const msg = error.message ?? '';
    if (/does not exist/i.test(msg) || /could not find.*table/i.test(msg)) {
      console.warn('⚠️  Tabla property_cadastral no existe. Aplicar migration 010.');
      persisted = false;
    } else {
      console.warn(`[property_cadastral] upsert falló: ${msg}`);
      persisted = false;
    }
  }

  return { ...result, persisted };
}
