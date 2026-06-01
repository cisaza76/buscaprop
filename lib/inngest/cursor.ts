// lib/inngest/cursor.ts
// CRUD del scraper_cursor en Supabase.

import { supabaseAdmin } from '../supabase';
import type { SourcePortal } from '../scrapers/shared/types';
import { SITEMAP_ORDER_VERSION } from '../scrapers/fincaraiz';

export interface ScraperCursor {
  portal: SourcePortal;
  last_sitemap_idx: number;
  last_url_idx: number;
  last_combo_idx: number;
  // Ciclo del crawl con ventana CAP (Fincaraíz) — migración 019.
  last_cycle: number;
  // Versión del orden de sitemaps con que se guardó este cursor — migración 019.
  sitemap_order_version: number;
  total_processed: number;
  total_upserted: number;
  last_run_at: string | null;
  last_run_status: 'success' | 'partial' | 'error' | null;
  last_run_message: string | null;
}

/**
 * Reconciliación pura del cursor contra la versión de orden de sitemaps del
 * código. Si el cursor se guardó con un orden viejo (versión menor), hay que
 * resetear la posición — sitemap_idx/url_idx apuntan a sitemaps que tras el
 * reorden ya no están en ese índice. Reseteamos cycle a 0: un reorden remapea
 * los índices, así que el `cycle` viejo no tiene continuidad; conservarlo haría
 * que los sitemaps recién alcanzables (casa/oficina/lote) saltaran su ventana
 * [0,CAP). El cache-by-lastmod hace barato el re-escaneo desde 0.
 *
 * Es pura (sin I/O) para poder testearla; getCursor la aplica y persiste.
 */
export function reconcileSitemapOrderVersion(
  stored: {
    last_sitemap_idx: number;
    last_url_idx: number;
    last_cycle: number;
    sitemap_order_version: number;
  },
  codeVersion: number
): {
  cursor: {
    last_sitemap_idx: number;
    last_url_idx: number;
    last_cycle: number;
    sitemap_order_version: number;
  };
  didReset: boolean;
} {
  if (stored.sitemap_order_version >= codeVersion) {
    return { cursor: stored, didReset: false };
  }
  return {
    cursor: {
      last_sitemap_idx: 0,
      last_url_idx: 0,
      // Reset to cycle 0: re-cover [0,CAP) in new sitemap order
      // Maintains proportional breadth; cache makes re-scan cheap
      last_cycle: 0,
      sitemap_order_version: codeVersion,
    },
    didReset: true,
  };
}

/**
 * Lee cursor del portal. Si no existe (no debería, hay seed), devuelve cursor inicial.
 */
export async function getCursor(portal: SourcePortal): Promise<ScraperCursor> {
  const { data, error } = await supabaseAdmin
    .from('scraper_cursor')
    .select('*')
    .eq('portal', portal)
    .single();
  if (error || !data) {
    // Fallback — cursor inicial. Si la tabla no existe, fail loud.
    if (error?.code === 'PGRST116' /* not found */) {
      return {
        portal,
        last_sitemap_idx: 0,
        last_url_idx: 0,
        last_combo_idx: 0,
        last_cycle: 0,
        // Cursor nuevo → arranca en la versión de orden actual (sin migración).
        sitemap_order_version: SITEMAP_ORDER_VERSION,
        total_processed: 0,
        total_upserted: 0,
        last_run_at: null,
        last_run_status: null,
        last_run_message: null,
      };
    }
    throw new Error(`getCursor(${portal}): ${error?.message ?? 'unknown'}`);
  }

  const cursor = data as ScraperCursor;

  // Reset automático si el orden de sitemaps cambió desde que se guardó. Aplica
  // a Fincaraíz (único portal con orden versionado). Corre aquí porque el tick
  // ya llama getCursor → migra solo post-deploy, sin tocar functions.ts.
  if (portal === 'fincaraiz') {
    const { cursor: reconciled, didReset } = reconcileSitemapOrderVersion(
      {
        last_sitemap_idx: cursor.last_sitemap_idx,
        last_url_idx: cursor.last_url_idx,
        last_cycle: cursor.last_cycle ?? 0,
        sitemap_order_version: cursor.sitemap_order_version ?? 0,
      },
      SITEMAP_ORDER_VERSION
    );
    if (didReset) {
      await updateCursor(portal, {
        last_sitemap_idx: reconciled.last_sitemap_idx,
        last_url_idx: reconciled.last_url_idx,
        last_cycle: reconciled.last_cycle,
        sitemap_order_version: reconciled.sitemap_order_version,
        last_run_message: `Cursor reset due to sitemap reordering (Sección 1). New cycle: ${reconciled.last_cycle}`,
      });
      console.log(
        `[cursor] Cursor reset due to sitemap reordering (Sección 1). New cycle: ${reconciled.last_cycle}`
      );
      return { ...cursor, ...reconciled };
    }
  }

  return cursor;
}

/**
 * Actualiza cursor. Pasar solo los campos a cambiar.
 */
export async function updateCursor(
  portal: SourcePortal,
  patch: Partial<Omit<ScraperCursor, 'portal'>>
): Promise<void> {
  const { error } = await supabaseAdmin.from('scraper_cursor').update(patch).eq('portal', portal);
  if (error) throw new Error(`updateCursor(${portal}): ${error.message}`);
}

/**
 * Reset cursor a 0 — para forzar re-escaneo completo desde el inicio.
 */
export async function resetCursor(portal: SourcePortal): Promise<void> {
  await updateCursor(portal, {
    last_sitemap_idx: 0,
    last_url_idx: 0,
    last_combo_idx: 0,
    last_cycle: 0,
    last_run_status: null,
    last_run_message: 'reset manual',
  });
}
