// lib/ai/neighborhood-normalization.ts
// Resolver el nombre canónico de un barrio a partir de un input arbitrario
// del user. Pipeline:
//
//   1. Lookup exacto en `neighborhood_aliases` por (city, alias_normalizado).
//      → si encuentra, devuelve canonical_name.
//
//   2. Fallback: ILIKE search en properties.neighborhood (case-insensitive
//      con wildcards). Útil para barrios nuevos que no tienen alias todavía.
//      Usamos GROUP BY para devolver los nombres canónicos únicos.
//
//   3. Si nada match: fuzzy match con pg_trgm (similarity > 0.4) sobre
//      neighborhood_aliases.canonical_name. Devuelve top 3 candidates.
//
// Diseño: best-effort. Si la tabla aliases no existe (migration 012 no
// aplicada), cae al ILIKE search directamente. Nunca tira excepción —
// devuelve { canonical: null, candidates: [] }.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;
function getClient(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Faltan SUPABASE_URL / SERVICE_ROLE_KEY');
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

export interface NeighborhoodResolveResult {
  /** Nombre canónico exacto en properties.neighborhood. Null si no resolvió. */
  canonical: string | null;
  /** Cómo se resolvió: 'alias' (exact match), 'ilike' (substring), 'fuzzy', 'none'. */
  source: 'alias' | 'ilike' | 'fuzzy' | 'none';
  /** Si no resolvió a uno, top candidates para sugerirle al user. */
  candidates: string[];
}

/**
 * Normaliza string a forma comparable: lowercase + sin tildes + trim.
 * NO quita artículos — el alias en BD ya está sin artículo si corresponde.
 */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Variantes adicionales que probamos automáticamente. Si user dice
 * "Los Rosales" probamos también "rosales". Si dice "El Chico", probamos
 * "chico". Sirve cuando NO hay alias explícito.
 */
function expandVariants(input: string): string[] {
  const base = normalize(input);
  const variants = new Set<string>();
  variants.add(base);
  // Sin artículos al inicio.
  for (const article of ['el ', 'la ', 'los ', 'las ']) {
    if (base.startsWith(article)) {
      variants.add(base.slice(article.length));
    }
  }
  // Con artículos al inicio.
  for (const article of ['el ', 'la ', 'los ', 'las ']) {
    if (!base.match(/^(el|la|los|las)\s/)) {
      variants.add(article + base);
    }
  }
  return [...variants];
}

/**
 * Resolver el barrio. Devuelve siempre — nunca tira.
 */
export async function resolveNeighborhood(
  city: string,
  input: string
): Promise<NeighborhoodResolveResult> {
  if (!input || !city) {
    return { canonical: null, source: 'none', candidates: [] };
  }

  const sb = getClient();

  // ── Paso 1: lookup en aliases (exact + variantes con/sin artículo) ──
  const variants = expandVariants(input);
  try {
    const { data: aliasHits } = await sb
      .from('neighborhood_aliases')
      .select('canonical_name, alias')
      .eq('city', city)
      .in('alias', variants)
      .limit(5);
    if (aliasHits && aliasHits.length > 0) {
      // Preferir match más específico (alias más largo).
      const sorted = [...aliasHits].sort(
        (a, b) => (b.alias as string).length - (a.alias as string).length
      );
      return {
        canonical: sorted[0].canonical_name as string,
        source: 'alias',
        candidates: [sorted[0].canonical_name as string],
      };
    }
  } catch {
    // Tabla no existe → seguir al fallback.
  }

  // ── Paso 2: ILIKE en properties.neighborhood ──
  // Buscamos canonical names que contengan el input (case-insensitive).
  try {
    const { data: ilikeHits } = await sb
      .from('properties')
      .select('neighborhood')
      .eq('city', city)
      .ilike('neighborhood', `%${input.trim()}%`)
      .not('neighborhood', 'is', null)
      .limit(200);
    const counts = new Map<string, number>();
    for (const r of ilikeHits ?? []) {
      const n = r.neighborhood as string;
      counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    if (counts.size === 1) {
      const [single] = counts.keys();
      return {
        canonical: single,
        source: 'ilike',
        candidates: [single],
      };
    }
    if (counts.size > 1) {
      // Múltiples matches — devolver el más frecuente como canonical, pero
      // exponemos los candidates para que la AI pregunte si hay ambigüedad.
      const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
      return {
        canonical: sorted[0][0],
        source: 'ilike',
        candidates: sorted.slice(0, 5).map(([name]) => name),
      };
    }
  } catch {
    // Sin properties tabla? Imposible, pero por las dudas.
  }

  // ── Paso 3: fuzzy match contra aliases con pg_trgm ──
  // Usamos `select` con un ORDER BY similarity (Postgres pg_trgm). Como
  // PostgREST no expone funciones custom, hacemos una RPC alternativa con
  // ILIKE de trigramas básicos (split en palabras + ILIKE OR).
  try {
    const words = normalize(input).split(/\s+/).filter((w) => w.length >= 3);
    if (words.length === 0) {
      return { canonical: null, source: 'none', candidates: [] };
    }
    const orFilter = words.map((w) => `canonical_name.ilike.%${w}%`).join(',');
    const { data: fuzzyHits } = await sb
      .from('neighborhood_aliases')
      .select('canonical_name')
      .eq('city', city)
      .or(orFilter)
      .limit(10);
    const uniq = [
      ...new Set((fuzzyHits ?? []).map((r) => r.canonical_name as string)),
    ];
    if (uniq.length > 0) {
      return {
        canonical: null, // ambiguo — el caller debería preguntar
        source: 'fuzzy',
        candidates: uniq.slice(0, 5),
      };
    }
  } catch {
    // skip
  }

  return { canonical: null, source: 'none', candidates: [] };
}
