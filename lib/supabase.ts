// lib/supabase.ts
import { notifySignupCompleted } from '@/lib/analytics/signup-notify';
import { createClient } from '@supabase/supabase-js';
import type { User, Session } from '@supabase/supabase-js';
import { normalizeSupabaseUrl } from './supabase-url';

// Normalizado: un secret con sufijo '/rest/v1/' rompía TODAS las llamadas con
// PGRST125. Ver lib/supabase-url.ts.
const supabaseUrl = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '');
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Faltan variables de entorno de Supabase');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Cliente con service_role key — bypassea RLS. Usar SOLO en código server-side
 * (Inngest workers, scripts, API routes que requieran tablas internas como
 * scraper_cursor). NUNCA exponer al frontend.
 *
 * Si SUPABASE_SERVICE_ROLE_KEY no está definida, fallback al anon client
 * (permite que el código corra en local sin la key, aunque algunas operaciones
 * fallen por RLS).
 */
export const supabaseAdmin = supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : supabase;

// ============================================================================
// TIPOS
// ============================================================================

export interface AuthUser extends User {
  user_metadata: {
    full_name?: string;
    [key: string]: any;
  };
}

export interface UserProfile {
  id: string;
  agency_id: string;
  full_name: string;
  role: 'owner' | 'agent';
  created_at: string;
}

export interface Agency {
  id: string;
  name: string;
  plan: 'solo' | 'team' | 'inmobiliaria';
  max_agents: number;
  subscription_status: 'active' | 'trial' | 'cancelled';
  created_at: string;
}

export interface Property {
  id: string;
  source_portal: 'fincaraiz' | 'metrocuadrado' | 'properati' | 'ciencuadras';
  source_url: string;
  title: string;
  description: string;
  price_cop: number;
  city: string;
  neighborhood?: string;
  bedrooms?: number;
  bathrooms?: number;
  area_m2?: number;
  property_type: 'apartamento' | 'casa' | 'oficina' | 'lote';
  listing_type: 'venta' | 'arriendo';
  photos: string[];
  latitude?: number;
  longitude?: number;
  is_duplicate: boolean;
  /**
   * false = el portal de origen ya no lo publica. La búsqueda lo filtra; la
   * ficha por link directo NO — sigue sirviendo, con aviso en la UI, para no
   * romper links compartidos y conversaciones ya existentes.
   */
  is_active: boolean;
  /** Última vez que un scraper vio esta propiedad en el portal de origen. */
  scraped_at?: string | null;
  canonical_id?: string;
  /** Agente o empresa que publicó (poblado por scrapers post-migration 004). */
  contact_name?: string | null;
  /** Teléfono del agente en E.164 sin '+' (formato wa.me/). null si no disponible. */
  contact_phone?: string | null;
  /** Nombre de la empresa/agencia. */
  company_name?: string | null;
  created_at: string;
}

// ============================================================================
// AUTENTICACIÓN
// ============================================================================

// Traduce los errores de Supabase Auth a algo que el usuario pueda accionar.
// Antes el registro mostraba "Error en registro" para todo: el error de
// Supabase no es instancia de Error y caía siempre al mensaje genérico.
export function describeAuthError(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof (error as { message?: unknown })?.message === 'string'
        ? (error as { message: string }).message
        : '';
  if (/already registered|already exists/i.test(raw)) {
    return 'Ya existe una cuenta con ese correo. Inicia sesión o recupera tu contraseña.';
  }
  if (/password should be at least|weak password/i.test(raw)) {
    return 'La contraseña es muy débil: usa al menos 8 caracteres.';
  }
  if (/invalid.*email|email address .* is invalid/i.test(raw)) {
    return 'El correo no es válido.';
  }
  if (/rate limit|too many/i.test(raw)) {
    return 'Demasiados intentos seguidos. Espera un minuto y vuelve a intentar.';
  }
  if (/fetch|network/i.test(raw)) {
    return 'No pudimos conectar con el servidor. Revisa tu conexión y vuelve a intentar.';
  }
  return raw ? `No pudimos crear la cuenta: ${raw}` : 'No pudimos crear la cuenta. Intenta de nuevo.';
}

// La agencia y el perfil los crea la base (trigger handle_new_user, migración
// 024) en la misma transacción que la cuenta. Crearlos desde el browser
// fallaba por RLS en el RETURNING de agencies y dejaba cuentas sin perfil
// (13 de 14 al 2026-09-28).
export async function signUpWithEmail(
  email: string,
  password: string,
  fullName: string,
  agencyName?: string
): Promise<{ success: true; user: AuthUser } | { success: false; error: string }> {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
        ...(agencyName ? { agency_name: agencyName } : {}),
      },
    },
  });
  if (error) return { success: false, error: describeAuthError(error) };
  if (!data.user) return { success: false, error: describeAuthError(null) };
  notifySignupCompleted(data.session?.access_token);
  return { success: true, user: data.user as AuthUser };
}

export async function signInWithEmail(email: string, password: string) {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;

    return {
      success: true,
      user: data.user,
      session: data.session,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error al iniciar sesión',
    };
  }
}

export async function getCurrentSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const { data } = await supabase.auth.getUser();
  return data.user as AuthUser | null;
}

export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    // maybeSingle: un perfil ausente es null, no un 406 (cuentas del registro
    // roto antes de la migración 024).
    .maybeSingle();

  if (error) {
    console.error('Error obteniendo perfil:', error);
    return null;
  }

  return data;
}

export async function getUserAgency(userId: string): Promise<Agency | null> {
  const profile = await getUserProfile(userId);
  if (!profile) return null;

  const { data, error } = await supabase
    .from('agencies')
    .select('*')
    .eq('id', profile.agency_id)
    .maybeSingle();

  if (error) {
    console.error('Error obteniendo agencia:', error);
    return null;
  }

  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

// ============================================================================
// PROPIEDADES
// ============================================================================

export async function searchProperties(filters: {
  /** Texto libre: ILIKE case-insensitive sobre `title`. */
  query?: string;
  city?: string;
  neighborhood?: string;
  listing_type?: 'venta' | 'arriendo';
  property_type?: string;
  min_price?: number;
  max_price?: number;
  min_bedrooms?: number;
  /** Máximo habitaciones. Útil para "2 cuartos exactos" → max=min=2. */
  max_bedrooms?: number;
  min_area?: number;
  limit?: number;
  offset?: number;
}) {
  // count: 'exact' → PostgREST devuelve el total que matchea (ignorando
  // range/limit). Sin esto, `count` venía null y la UI solo conocía el
  // tamaño de página, no el total real.
  let query = supabase
    .from('properties')
    .select('*', { count: 'exact' })
    .eq('is_duplicate', false)
    // Sin esto, un inmueble retirado del portal le sale al usuario igual que
    // uno vivo. Ver migración 021.
    .eq('is_active', true);

  // Texto libre: ILIKE 'word%word%' sobre title. Insensible a mayúsculas/tildes.
  // Nota: PostgREST escapa el valor automáticamente; no hay riesgo de SQL injection.
  if (filters.query?.trim()) {
    const q = filters.query.trim();
    query = query.ilike('title', `%${q}%`);
  }
  if (filters.city) query = query.eq('city', filters.city);
  // CRÍTICO: el barrio puede llegar con capitalización/forma distinta de la que
  // está en BD (ej: user dice "Rosales" pero BD tiene "Los Rosales"). Usamos
  // ILIKE para tolerar casos comunes. La normalización profunda (alias canónico)
  // se hace upstream en lib/ai/tools.ts antes de llamar acá.
  if (filters.neighborhood) {
    query = query.ilike('neighborhood', filters.neighborhood);
  }
  if (filters.listing_type) query = query.eq('listing_type', filters.listing_type);
  if (filters.property_type) query = query.eq('property_type', filters.property_type);
  // CRÍTICO: price_cop es bigint en Postgres — NO acepta decimales. Cuando
  // el caller pasa X*0.85 o X*1.15 (ej. 14_000_000 * 1.15 = 16_099_999.99...),
  // la query falla silenciosamente con "invalid input syntax for type bigint".
  // Math.floor/ceil garantiza enteros y conserva la semántica del rango
  // (floor del min para no excluir borderlines, ceil del max para incluirlos).
  if (filters.min_price) query = query.gte('price_cop', Math.floor(filters.min_price));
  if (filters.max_price) query = query.lte('price_cop', Math.ceil(filters.max_price));
  if (filters.min_bedrooms) query = query.gte('bedrooms', filters.min_bedrooms);
  if (filters.max_bedrooms) query = query.lte('bedrooms', filters.max_bedrooms);
  if (filters.min_area) query = query.gte('area_m2', filters.min_area);

  const limit = filters.limit || 50;
  const offset = filters.offset || 0;

  query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);

  const { data, error, count } = await query;

  if (error) throw error;

  return {
    properties: data || [],
    count: count ?? 0,
  };
}

/**
 * Fetch un property específico por su id (UUID). Devuelve null si no existe
 * o si el caller no tiene permisos. RLS aplica igual que en searchProperties.
 */
export async function fetchPropertyById(id: string): Promise<Property | null> {
  if (!id) return null;
  const { data, error } = await supabase
    .from('properties')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    console.error('Error obteniendo propiedad:', error);
    return null;
  }
  return (data as Property | null) ?? null;
}

// Barrios de una ciudad para el desplegable del dashboard. La función SQL
// neighborhoods_by_city (migración 023) hace el DISTINCT sobre todo el
// inventario vivo; antes se deduplicaban en el browser las primeras 5.000
// filas y Bogotá mostraba 257 de ~2.400 barrios (2026-09-28).
// Solo barrios con al menos MIN_LISTINGS avisos: los de 1-2 suelen ser
// variantes ruidosas ("Chico Norte Edif Pino Alto") que alargan la lista.
const MIN_LISTINGS_PER_NEIGHBORHOOD = 3;

export async function fetchNeighborhoodsByCity(city: string): Promise<string[]> {
  if (!city) return [];
  const { data, error } = await supabase.rpc('neighborhoods_by_city', { p_city: city });
  if (!error && data) {
    return (data as Array<{ neighborhood: string; listings: number }>)
      .filter((r) => r.listings >= MIN_LISTINGS_PER_NEIGHBORHOOD)
      .map((r) => r.neighborhood)
      .sort((a, b) => a.localeCompare(b, 'es-CO'));
  }
  console.error('neighborhoods_by_city falló, uso muestra de filas:', error);
  return fetchNeighborhoodsSample(city);
}

// Respaldo si la RPC no está (migración 023 sin aplicar) o da timeout: muestra
// de 5.000 filas deduplicada acá. Incompleta a propósito — mejor lista parcial
// que desplegable vacío.
async function fetchNeighborhoodsSample(city: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('properties')
    .select('neighborhood')
    .eq('city', city)
    .eq('is_duplicate', false)
    // Evita ofrecer barrios que solo existen en inventario muerto.
    .eq('is_active', true)
    .not('neighborhood', 'is', null)
    .limit(5000);
  if (error) {
    console.error('Error obteniendo barrios:', error);
    return [];
  }
  const set = new Set<string>();
  for (const r of data ?? []) {
    if (r.neighborhood) set.add(r.neighborhood);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'es-CO'));
}

// ============================================================================
// BÚSQUEDAS GUARDADAS
// ============================================================================

export async function savesearch(
  userId: string,
  searchQuery: string,
  filters: Record<string, any>,
  shareLink?: boolean
) {
  const shareLinkId = shareLink ? generateShareLinkId() : null;

  const { data, error } = await supabase
    .from('saved_searches')
    .insert({
      user_id: userId,
      search_query: searchQuery,
      filters,
      share_link_id: shareLinkId,
      alert_enabled: false,
    })
    .select()
    .single();

  if (error) throw error;

  return data;
}

export async function fetchSavedSearches(userId: string) {
  const { data, error } = await supabase
    .from('saved_searches')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;

  return data || [];
}

export async function updateSavedSearch(
  id: string,
  patch: { search_query?: string; filters?: Record<string, any>; alert_enabled?: boolean }
) {
  const { data, error } = await supabase
    .from('saved_searches')
    .update(patch)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteSavedSearch(id: string) {
  const { error } = await supabase.from('saved_searches').delete().eq('id', id);
  if (error) throw error;
}

export async function toggleSavedSearchAlert(id: string, enabled: boolean) {
  return updateSavedSearch(id, { alert_enabled: enabled });
}

// ============================================================================
// UTILIDADES
// ============================================================================

function generateShareLinkId(): string {
  return Math.random().toString(36).substring(2, 15) +
         Math.random().toString(36).substring(2, 15);
}

export async function isAuthenticated(): Promise<boolean> {
  const session = await getCurrentSession();
  return !!session;
}

export function onAuthStateChange(
  callback: (user: AuthUser | null, session: Session | null) => void
) {
  return supabase.auth.onAuthStateChange((event, session) => {
    callback(session?.user as AuthUser | null, session);
  });
}
