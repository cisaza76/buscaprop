// lib/supabase-url.ts
// Normalización de la URL base de Supabase.
//
// Incidente 2026-08-18: el secret NEXT_PUBLIC_SUPABASE_URL de GitHub Actions
// estaba guardado como 'https://<ref>.supabase.co/rest/v1/' — la forma que
// muestra la consola de Supabase para el endpoint REST. supabase-js le
// concatena su propio '/rest/v1', quedando '…/rest/v1/rest/v1/properties', y
// PostgREST responde PGRST125 "Invalid path specified in request URL".
//
// El efecto fue total y silencioso: TODAS las llamadas desde el cron fallaban
// (0 upserted, 1500 errores por portal por run) mientras el workflow reportaba
// éxito. Normalizamos en el código para que una URL mal pegada no pueda volver
// a tumbar toda la escritura.

/**
 * Devuelve el origin que espera `createClient`, tolerando las formas en que
 * suele pegarse mal la URL: slash final, slashes repetidos, whitespace, o el
 * sufijo de servicio que muestra la consola (`/rest/v1`, `/auth/v1`, …).
 */
export function normalizeSupabaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  // Sufijo de servicio: supabase-js lo agrega solo. Dejarlo duplica el path.
  const withoutService = trimmed.replace(/\/(rest|auth|storage|realtime)\/v\d+$/i, '');
  return withoutService.replace(/\/+$/, '');
}
