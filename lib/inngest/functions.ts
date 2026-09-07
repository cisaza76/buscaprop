// lib/inngest/functions.ts
// Funciones Inngest para scraping incremental por portal.
// Cada función: lee cursor → corre scraper con chunk pequeño → guarda nextCursor.
//
// Schedule: cada 30 min para portales grandes (FR, CC) y 60 min para M2/PR.
// Con maxListings=150 por tick, ~150s de runtime → cabe en Vercel timeout 300s.
//
// Beneficio vs GH Actions:
//   - Reanuda donde quedó (cursor) → eventually-consistent 100% cobertura
//   - 50k events/mes free → ~17 ticks/h × 4 portales × 720h = 49k events/mes
//   - Retries automáticos con backoff
//   - Observability nativa (dashboard Inngest)

import { inngest } from './client';
import { getCursor, updateCursor } from './cursor';
import { scrapeFincaraiz } from '../scrapers/fincaraiz';
import { scrapeMetroCuadrado } from '../scrapers/metrocuadrado';
import { scrapeCiencuadras } from '../scrapers/ciencuadras';
import { scrapeProperati } from '../scrapers/properati';
import type { SourcePortal } from '../scrapers/shared/types';

// Cuántas propiedades procesar por tick. Vercel timeout 300s.
// Observado en producción: 50 URLs ≈ 198s (~70% del timeout). Bajamos a 35
// para tener margen de seguridad contra fluctuaciones de red/parser.
// Si subimos a Vercel Pro (800s), TICK_MAX puede ir a 150-200.
const TICK_MAX = 35;

// Pausa ante 403 acotada para el budget de 300s del tick (ver http.ts).
// Con el default de fetchText (600_000ms) UN SOLO 403 ya excede el budget
// completo — Vercel mata la invocación a mitad del sleep, sin excepción que
// capturar, y el step 'save-cursor' nunca corre: el cursor queda congelado
// con el último 'success' viejo para siempre (incidente properati 2026-09,
// cursor 251h stale). 8s de pausa + 1 solo reintento acota el peor caso de
// un portal bloqueado a ~20s por URL — el tick sigue pudiendo fallar, pero
// siempre termina a tiempo y llega a guardar el cursor.
const TICK_HTTP_BLOCK_WAIT_MS = 8_000;
const TICK_HTTP_MAX_RETRIES = 1;

/**
 * Persiste last_run_at/status incluso cuando el step 'scrape' falla. Sin
 * esto, un tick que revienta (error de parsing, upsert, etc. — no timeout de
 * plataforma, ese no se puede interceptar) deja el cursor con el timestamp
 * viejo para siempre y el health-check reporta staleness en vez del error
 * real.
 */
// step tipado laxo a propósito: solo usamos step.run(id, fn), y el tipo real
// (Inngest GetStepTools) es un generic gigante — no vale la pena replicarlo acá.
type TickStep = { run: (id: string, fn: () => Promise<unknown>) => Promise<unknown> };

async function recordTickError(step: TickStep, portal: SourcePortal, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  await step.run('save-cursor-error', () =>
    updateCursor(portal, {
      last_run_at: new Date().toISOString(),
      last_run_status: 'error',
      last_run_message: message.slice(0, 500),
    })
  );
}

export const scrapeFincaraizTick = inngest.createFunction(
  {
    id: 'scrape-fincaraiz-tick',
    name: 'Scrape Fincaraíz (incremental)',
    // limit:1 → un solo tick a la vez. Evita que un tick lento (ej pausa 403 de
    // 10min) deje correr el siguiente y produzca una race en updateCursor.
    concurrency: { limit: 1 },
    triggers: [{ cron: 'TZ=America/Bogota */30 * * * *' }],
  },
  async ({ step }) => {
    const cursor = await step.run('read-cursor', () => getCursor('fincaraiz'));

    let result;
    try {
      result = await step.run('scrape', () =>
        scrapeFincaraiz({
          maxListings: TICK_MAX,
          cursor: {
            sitemap_idx: cursor.last_sitemap_idx,
            url_idx: cursor.last_url_idx,
            cycle: cursor.last_cycle,
          },
        })
      );
    } catch (err) {
      await recordTickError(step, 'fincaraiz', err);
      throw err;
    }

    await step.run('save-cursor', () =>
      updateCursor('fincaraiz', {
        last_sitemap_idx: result.nextCursor?.last_sitemap_idx ?? 0,
        last_url_idx: result.nextCursor?.last_url_idx ?? 0,
        last_cycle: result.nextCursor?.last_cycle ?? 0,
        total_processed: cursor.total_processed + result.parsed,
        total_upserted: cursor.total_upserted + result.upserted,
        last_run_at: new Date().toISOString(),
        last_run_status: result.errors.length === 0 ? 'success' : 'partial',
        last_run_message: `+${result.upserted} upserted, ${result.errors.length} errors`,
      })
    );

    return {
      portal: 'fincaraiz',
      upserted: result.upserted,
      errors: result.errors.length,
      cursor: result.nextCursor,
    };
  }
);

export const scrapeCiencuadrasTick = inngest.createFunction(
  {
    id: 'scrape-ciencuadras-tick',
    name: 'Scrape Ciencuadras (incremental)',
    concurrency: { limit: 1 },
    triggers: [{ cron: 'TZ=America/Bogota */30 * * * *' }],
  },
  async ({ step }) => {
    const cursor = await step.run('read-cursor', () => getCursor('ciencuadras'));

    let result;
    try {
      result = await step.run('scrape', () =>
        scrapeCiencuadras({
          maxListings: TICK_MAX,
          cursor: {
            sitemap_idx: cursor.last_sitemap_idx,
            url_idx: cursor.last_url_idx,
          },
        })
      );
    } catch (err) {
      await recordTickError(step, 'ciencuadras', err);
      throw err;
    }

    await step.run('save-cursor', () =>
      updateCursor('ciencuadras', {
        last_sitemap_idx: result.nextCursor?.last_sitemap_idx ?? 0,
        last_url_idx: result.nextCursor?.last_url_idx ?? 0,
        total_processed: cursor.total_processed + result.parsed,
        total_upserted: cursor.total_upserted + result.upserted,
        last_run_at: new Date().toISOString(),
        last_run_status: result.errors.length === 0 ? 'success' : 'partial',
        last_run_message: `+${result.upserted} upserted, ${result.errors.length} errors`,
      })
    );

    return {
      portal: 'ciencuadras',
      upserted: result.upserted,
      errors: result.errors.length,
      cursor: result.nextCursor,
    };
  }
);

export const scrapeMetroCuadradoTick = inngest.createFunction(
  {
    id: 'scrape-metrocuadrado-tick',
    name: 'Scrape MetroCuadrado (incremental)',
    concurrency: { limit: 1 },
    triggers: [{ cron: 'TZ=America/Bogota 0 * * * *' }], // cada hora
  },
  async ({ step }) => {
    const cursor = await step.run('read-cursor', () => getCursor('metrocuadrado'));

    let result;
    try {
      result = await step.run('scrape', () =>
        scrapeMetroCuadrado({
          maxListings: TICK_MAX,
          cursor: { combo_idx: cursor.last_combo_idx },
        })
      );
    } catch (err) {
      await recordTickError(step, 'metrocuadrado', err);
      throw err;
    }

    await step.run('save-cursor', () =>
      updateCursor('metrocuadrado', {
        last_combo_idx: result.nextCursor?.last_combo_idx ?? 0,
        total_processed: cursor.total_processed + result.parsed,
        total_upserted: cursor.total_upserted + result.upserted,
        last_run_at: new Date().toISOString(),
        last_run_status: result.errors.length === 0 ? 'success' : 'partial',
        last_run_message: `+${result.upserted} upserted, ${result.errors.length} errors`,
      })
    );

    return {
      portal: 'metrocuadrado',
      upserted: result.upserted,
      errors: result.errors.length,
      cursor: result.nextCursor,
    };
  }
);

export const scrapeProperatiTick = inngest.createFunction(
  {
    id: 'scrape-properati-tick',
    name: 'Scrape Properati (incremental)',
    concurrency: { limit: 1 },
    triggers: [{ cron: 'TZ=America/Bogota 30 * * * *' }], // cada hora a la media
  },
  async ({ step }) => {
    const cursor = await step.run('read-cursor', () => getCursor('properati'));

    let result;
    try {
      result = await step.run('scrape', () =>
        scrapeProperati({
          maxListings: TICK_MAX,
          cursor: { combo_idx: cursor.last_combo_idx },
          // Properati es el portal que más 403-blockea (ver recon en
          // properati.ts). Sin esto, un solo 403 con el default de
          // fetchText (pausa de 10min) excede el budget del tick (300s) y
          // Vercel mata la invocación a mitad del sleep — el cursor queda
          // congelado para siempre porque 'save-cursor' nunca corre. Root
          // cause del incidente 2026-09 (cursor properati 251h stale).
          httpBlockWaitMs: TICK_HTTP_BLOCK_WAIT_MS,
          httpMaxRetries: TICK_HTTP_MAX_RETRIES,
        })
      );
    } catch (err) {
      await recordTickError(step, 'properati', err);
      throw err;
    }

    await step.run('save-cursor', () =>
      updateCursor('properati', {
        last_combo_idx: result.nextCursor?.last_combo_idx ?? 0,
        total_processed: cursor.total_processed + result.parsed,
        total_upserted: cursor.total_upserted + result.upserted,
        last_run_at: new Date().toISOString(),
        last_run_status: result.errors.length === 0 ? 'success' : 'partial',
        last_run_message: `+${result.upserted} upserted, ${result.errors.length} errors`,
      })
    );

    return {
      portal: 'properati',
      upserted: result.upserted,
      errors: result.errors.length,
      cursor: result.nextCursor,
    };
  }
);

// Array para registrar en serve().
export const scrapeFunctions = [
  scrapeFincaraizTick,
  scrapeCiencuadrasTick,
  scrapeMetroCuadradoTick,
  scrapeProperatiTick,
];
