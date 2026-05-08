// lib/scrapers/shared/metrics.ts
// Telemetría cruda de cada request HTTP del scraper. Una row por attempt en
// public.scrape_attempts. Best-effort:
//   - Fire-and-forget (no await) — el caller no espera.
//   - Si la tabla no existe (migration 016 no aplicada), warn UNA sola vez
//     por proceso y silencia los siguientes. Nunca crashea ni rompe el
//     scraper.
//   - Si el insert falla por otra razón (DB down, RLS, etc.), warn al log
//     pero igualmente continuar.
//
// Diseño: el caller (http.ts) construye el AttemptRecord con la info que ya
// tiene local (status, ms, ua, attempt#, error_kind). recordAttempt() lo
// inserta async. classifyStatus() es helper para mapear status_code → kind.

import { supabaseAdmin } from '../../supabase';

export type ErrorKind =
  | 'ok'
  | 'http_4xx'
  | 'http_429'
  | 'http_403'
  | 'http_5xx'
  | 'timeout'
  | 'network';

export interface AttemptRecord {
  /** Portal lógico ('fincaraiz', 'ciencuadras', etc.). */
  portal: string;
  /** Host del URL — útil cuando un portal usa múltiples hosts. */
  host: string;
  /** URL completa. Truncado a 500 chars en el insert. */
  url: string;
  /** HTTP status. Null si fue error de red (timeout/abort/DNS). */
  status_code: number | null;
  /** ms desde envío hasta primer byte. */
  response_ms: number;
  /** Bytes del body. Null si no se llegó a leer (retry sin consumir body). */
  bytes: number | null;
  /** UA usado en este attempt. */
  ua: string | null;
  /** # attempt dentro del retry loop (1-indexed). */
  attempt: number;
  /** Categoría del error para agregación rápida. */
  error_kind: ErrorKind;
  /** Mensaje del error si aplica. Truncado a 500 chars. */
  error_message: string | null;
}

let warnedMissingTable = false;
let warnedNoClient = false;

export function recordAttempt(rec: AttemptRecord): void {
  if (!supabaseAdmin) {
    if (!warnedNoClient) {
      console.warn('[metrics] supabaseAdmin no disponible — métricas descartadas');
      warnedNoClient = true;
    }
    return;
  }
  // Fire-and-forget. Catch dentro del IIFE para que rejection no escape.
  void (async () => {
    try {
      const { error } = await supabaseAdmin.from('scrape_attempts').insert({
        portal: rec.portal,
        host: rec.host,
        url: rec.url.slice(0, 500),
        status_code: rec.status_code,
        response_ms: rec.response_ms,
        bytes: rec.bytes,
        ua: rec.ua?.slice(0, 300) ?? null,
        attempt: rec.attempt,
        error_kind: rec.error_kind,
        error_message: rec.error_message?.slice(0, 500) ?? null,
      });
      if (error) {
        const msg = error.message ?? '';
        const missing =
          /does not exist/i.test(msg) || /could not find.*table/i.test(msg);
        if (missing) {
          if (!warnedMissingTable) {
            console.warn(
              '⚠️  Tabla scrape_attempts no existe. Aplicar migration 016. ' +
                'Métricas se descartan silenciosamente hasta entonces.'
            );
            warnedMissingTable = true;
          }
        } else {
          console.warn(`[metrics] insert falló: ${msg}`);
        }
      }
    } catch {
      // Nunca propagar.
    }
  })();
}

/** Mapea un HTTP status a un ErrorKind. Útil desde http.ts. */
export function classifyStatus(
  status: number | null,
  override?: 'timeout' | 'network'
): ErrorKind {
  if (override) return override;
  if (status === null) return 'network';
  if (status >= 200 && status < 300) return 'ok';
  if (status === 429) return 'http_429';
  if (status === 403) return 'http_403';
  if (status >= 400 && status < 500) return 'http_4xx';
  if (status >= 500 && status < 600) return 'http_5xx';
  return 'http_4xx';
}
