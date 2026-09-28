// lib/scrapers/shared/sweep-health.ts
// ¿El barrido de disponibilidad está viendo algo? Veredicto por portal sobre
// las últimas 24h, para check-scraper-health.ts.
//
// Dos modos de falla muda que esto atrapa:
//   - 'blind': el barrido corre pero no reconoce ningún retiro. Las señales
//     son frases exactas de cada portal (liveness.ts); si un portal las cambia,
//     todo sale 'live' y el inventario muerto vuelve a acumularse con el job en
//     verde. Medido 2026-09-28: 40-80% de retiros al limpiar el atraso; en
//     régimen baja (los arriendos se re-verifican cada 3 días), pero un portal
//     real nunca retira ~0% de lo que revisamos.
//   - 'stalled': cero verificaciones en 24h en un portal activo (workflow
//     desactivado, falla antes de empezar, cola rota).
//
// Vive aparte del script para poder testearse sin red ni credenciales.

export interface SweepSample {
  portal: string;
  /** Verificaciones del barrido en la ventana (scrape_attempts 'sweep:*'). */
  checked: number;
  /** De esas, cuántas dieron 'sweep:gone'. */
  gone: number;
}

export interface SweepProblem {
  kind: 'blind' | 'stalled';
  message: string;
}

/** Muestra mínima para opinar sobre la tasa: con menos, un 0% puede ser azar. */
export const MIN_SAMPLE = 300;
/** Por debajo de esto, con muestra suficiente, asumimos clasificador ciego. */
export const MIN_GONE_RATE = 0.01;

export function evaluateSweepHealth(s: SweepSample): SweepProblem | null {
  if (s.checked === 0) {
    return {
      kind: 'stalled',
      message: `${s.portal}: 0 avisos verificados en 24h — el barrido de disponibilidad no está corriendo (ver availability-sweep.yml)`,
    };
  }
  const rate = s.gone / s.checked;
  if (s.checked >= MIN_SAMPLE && rate < MIN_GONE_RATE) {
    return {
      kind: 'blind',
      message:
        `${s.portal}: ${s.gone}/${s.checked} retirados en 24h (${(rate * 100).toFixed(2)}%) — ` +
        'probable cambio en la página de "no disponible" del portal; revisar GONE_PHRASES en lib/scrapers/shared/liveness.ts',
    };
  }
  return null;
}
