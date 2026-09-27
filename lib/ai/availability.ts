// lib/ai/availability.ts
// Filtra resultados de búsqueda del chat a los avisos que siguen publicados
// en su portal, y marca los retirados como inactivos en la BD.
// Ver lib/scrapers/shared/liveness.ts para el porqué y las señales por portal.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { checkManyLive, type Liveness } from '@/lib/scrapers/shared/liveness';

let cachedClient: SupabaseClient | null = null;
function getClient(): SupabaseClient {
  if (cachedClient) return cachedClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Faltan SUPABASE_URL / SERVICE_ROLE_KEY');
  cachedClient = createClient(url, key, { auth: { persistSession: false } });
  return cachedClient;
}

export async function filterLiveProperties<T extends { id: string; source_url: string }>(
  candidates: T[],
  limit: number
): Promise<{ properties: T[]; goneCount: number; status: Map<string, Liveness> }> {
  const verdicts = await checkManyLive(candidates.map((c) => c.source_url));
  const status = new Map<string, Liveness>();
  candidates.forEach((c, i) => status.set(c.id, verdicts[i]));

  const goneIds = candidates.filter((_, i) => verdicts[i] === 'gone').map((c) => c.id);
  if (goneIds.length) {
    // Best-effort: si falla la escritura, el filtro de esta respuesta igual
    // aplica; solo perdemos el aprendizaje para la próxima búsqueda.
    const { error } = await getClient()
      .from('properties')
      .update({ is_active: false })
      .in('id', goneIds);
    if (error) console.warn(`[availability] no pude marcar inactivas: ${error.message}`);
  }

  return {
    properties: candidates.filter((_, i) => verdicts[i] !== 'gone').slice(0, limit),
    goneCount: goneIds.length,
    status,
  };
}
