// lib/scrapers/shared/run-outcome.ts
// Veredicto de una corrida de scraping: ¿esto fue un éxito o un fracaso mudo?
//
// Motivación (incidente Properati, 26-ago-2026): el scraper hizo 2.080 fetches,
// los 2.080 devolvieron HTTP 401, escribió 0 filas — y el job de GitHub Actions
// salió VERDE en cada corrida durante 6 días porque el proceso terminaba con
// exit 0. Un portal que no escribe nada y además acumula errores no es un
// éxito, y quien mire el CI tiene que poder verlo sin abrir los logs.
//
// Vive aparte de scripts/scrape-once.ts para poder testearse sin red ni env:
// ese script importa el runner, que a su vez exige credenciales de Supabase en
// tiempo de import.

import type { ScrapeError, ScrapeResult } from './types';

/**
 * Corridas que fallaron de forma silenciosa: cero filas escritas Y errores.
 *
 * El "Y" importa. Un portal ya drenado puede legítimamente escribir 0 en un
 * tick tranquilo; lo que no puede es escribir 0 mientras algo falla.
 */
export function failedRuns(results: ScrapeResult[]): ScrapeResult[] {
  return results.filter((r) => r.upserted === 0 && r.errors.length > 0);
}

/**
 * Etiqueta del error más repetido de una corrida, para que la línea de fallo
 * diga "HTTP 401" en vez de obligar a bucear 2.000 líneas de log.
 */
export function dominantError(errors: ScrapeError[]): string {
  if (errors.length === 0) return 'sin errores';
  const tally = new Map<string, number>();
  for (const e of errors) {
    // Agrupamos por código HTTP cuando lo hay: 401 (auth nueva), 403 (WAF) y
    // 429 (rate limit) piden respuestas distintas. Si no, por etapa + prefijo
    // del mensaje, que basta para distinguir un parser roto de una red caída.
    const key = e.message.match(/HTTP \d{3}/)?.[0] ?? `${e.stage}: ${e.message.slice(0, 60)}`;
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  const [label, n] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
  return `dominante: ${label} (${n}/${errors.length})`;
}
