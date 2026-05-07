// lib/inngest/cursor.ts
// CRUD del scraper_cursor en Supabase.

import { supabase } from '../supabase';
import type { SourcePortal } from '../scrapers/shared/types';

export interface ScraperCursor {
  portal: SourcePortal;
  last_sitemap_idx: number;
  last_url_idx: number;
  last_combo_idx: number;
  total_processed: number;
  total_upserted: number;
  last_run_at: string | null;
  last_run_status: 'success' | 'partial' | 'error' | null;
  last_run_message: string | null;
}

/**
 * Lee cursor del portal. Si no existe (no debería, hay seed), devuelve cursor inicial.
 */
export async function getCursor(portal: SourcePortal): Promise<ScraperCursor> {
  const { data, error } = await supabase
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
        total_processed: 0,
        total_upserted: 0,
        last_run_at: null,
        last_run_status: null,
        last_run_message: null,
      };
    }
    throw new Error(`getCursor(${portal}): ${error?.message ?? 'unknown'}`);
  }
  return data as ScraperCursor;
}

/**
 * Actualiza cursor. Pasar solo los campos a cambiar.
 */
export async function updateCursor(
  portal: SourcePortal,
  patch: Partial<Omit<ScraperCursor, 'portal'>>
): Promise<void> {
  const { error } = await supabase.from('scraper_cursor').update(patch).eq('portal', portal);
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
    last_run_status: null,
    last_run_message: 'reset manual',
  });
}
