// lib/ai/zone-alternatives.ts
// Cuando searchProperties devuelve 0 o pocas opciones en un barrio específico,
// la AI llama findAlternativeZones() para traer datos REALES de barrios
// vecinos del mismo perfil. Esto evita el patrón anti-pattern donde la AI
// inventa nombres de barrios alternativos sin buscar.
//
// Diseño:
//   1. Mapping curado de "barrio → vecinos del mismo perfil socioeconómico".
//   2. Una sola query SQL con IN(...neighbors) — eficiente, no N queries.
//   3. Agrupación en JS por barrio: count + avg_price + 2-3 samples por zona.
//
// Cuando agreguemos un barrio al mapping pensamos:
//   - ¿Mismo estrato/perfil? (Rosales → Chicó OK, Rosales → Engativá NO)
//   - ¿Misma operación dominante? (sale vs rent)
//   - ¿Adyacencia geográfica razonable? (15-20 min máx)

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

// ============================================================================
// Mapping de zonas alternativas
// ============================================================================
//
// Keys son lowercase + sin tildes para hacer matching robusto.
// Values son los names canónicos como aparecen en la DB (con tildes/mayúsculas).
//
// Curado para Bogotá premium primero (donde más se usa el patrón Rosales/Chicó/
// Usaquén). Otras ciudades agregamos según necesidad.

const ALTERNATIVE_ZONES_BOGOTA: Record<string, string[]> = {
  // ── Norte premium (estrato 6) ──
  rosales: ['El Chicó', 'La Cabrera', 'El Nogal', 'Quinta Camacho', 'El Refugio'],
  'el chico': ['Rosales', 'La Cabrera', 'El Nogal', 'Country Club', 'Chicó Norte'],
  chico: ['Rosales', 'La Cabrera', 'El Nogal', 'Country Club', 'Chicó Norte'],
  'chico norte': ['El Chicó', 'Rosales', 'La Cabrera', 'Country Club'],
  'la cabrera': ['Rosales', 'El Chicó', 'El Nogal', 'Quinta Camacho'],
  'el nogal': ['Rosales', 'El Chicó', 'La Cabrera', 'Quinta Camacho'],
  'el refugio': ['Rosales', 'El Chicó', 'La Cabrera'],
  'country club': ['El Chicó', 'Santa Bárbara', 'Bella Suiza', 'Cedritos'],
  'santa barbara': ['Country Club', 'Cedritos', 'Bella Suiza', 'Usaquén'],
  'santa bárbara': ['Country Club', 'Cedritos', 'Bella Suiza', 'Usaquén'],

  // ── Usaquén / Cedritos ──
  usaquen: ['Santa Bárbara', 'Cedritos', 'Bella Suiza', 'Country Club', 'El Contador'],
  usaquén: ['Santa Bárbara', 'Cedritos', 'Bella Suiza', 'Country Club', 'El Contador'],
  cedritos: ['Country Club', 'Mirandela', 'La Carolina', 'Santa Bárbara'],
  'bella suiza': ['Usaquén', 'Santa Bárbara', 'Country Club'],
  mirandela: ['Cedritos', 'La Carolina', 'Country Club'],

  // ── Chapinero (estrato 5-6) ──
  chapinero: ['Chapinero Alto', 'Quinta Camacho', 'La Soledad', 'Sucre', 'Marly'],
  'chapinero alto': ['Chapinero', 'Quinta Camacho', 'El Nogal', 'Rosales'],
  'chapinero norte': ['Chapinero Alto', 'Quinta Camacho', 'El Nogal'],
  'quinta camacho': ['Chapinero Alto', 'Rosales', 'El Nogal', 'La Cabrera'],
  'la soledad': ['Chapinero', 'Sucre', 'Teusaquillo', 'La Magdalena'],
  marly: ['Chapinero', 'La Soledad', 'Sucre'],

  // ── Centro / histórico (estrato 3-4) ──
  candelaria: ['La Catedral', 'Las Aguas', 'Egipto', 'La Macarena'],
  'la candelaria': ['La Catedral', 'Las Aguas', 'Egipto', 'La Macarena'],
  'la macarena': ['La Candelaria', 'Las Aguas', 'Bosque Izquierdo'],
  teusaquillo: ['La Soledad', 'La Magdalena', 'Pablo VI', 'Galerías'],

  // ── Nor-occidente (estrato 4-5) ──
  suba: ['Niza', 'Mazurén', 'Colina Campestre', 'Salitre'],
  niza: ['Suba', 'Mazurén', 'Colina Campestre', 'Pasadena'],
  'colina campestre': ['Niza', 'Suba', 'Mazurén'],
  pasadena: ['Niza', 'Salitre', 'Colina Campestre'],
  salitre: ['Niza', 'Pasadena', 'Salitre Greco'],

  // ── Modelia / occidente ──
  modelia: ['Hayuelos', 'El Tintal', 'Castilla'],
  hayuelos: ['Modelia', 'El Tintal', 'Castilla'],
};

const ALTERNATIVE_ZONES_MEDELLIN: Record<string, string[]> = {
  'el poblado': ['Laureles', 'Provenza', 'Manila', 'Lalinde', 'Las Lomas'],
  poblado: ['Laureles', 'Provenza', 'Manila', 'Lalinde', 'Las Lomas'],
  laureles: ['El Poblado', 'Estadio', 'Belén', 'La América'],
  envigado: ['Sabaneta', 'El Poblado', 'Itagüí'],
  sabaneta: ['Envigado', 'Itagüí', 'El Poblado'],
};

const ALTERNATIVE_ZONES_CARTAGENA: Record<string, string[]> = {
  bocagrande: ['Castillogrande', 'El Laguito', 'Manga'],
  castillogrande: ['Bocagrande', 'El Laguito', 'Manga'],
  'el laguito': ['Bocagrande', 'Castillogrande'],
  manga: ['Bocagrande', 'Pie de la Popa', 'Pie del Cerro'],
  'centro historico': ['Getsemaní', 'San Diego', 'La Matuna'],
  'centro histórico': ['Getsemaní', 'San Diego', 'La Matuna'],
  getsemani: ['Centro Histórico', 'San Diego'],
  getsemaní: ['Centro Histórico', 'San Diego'],
};

const ALTERNATIVE_ZONES_BY_CITY: Record<string, Record<string, string[]>> = {
  bogota: ALTERNATIVE_ZONES_BOGOTA,
  bogotá: ALTERNATIVE_ZONES_BOGOTA,
  'bogota d.c.': ALTERNATIVE_ZONES_BOGOTA,
  'bogotá d.c.': ALTERNATIVE_ZONES_BOGOTA,
  medellin: ALTERNATIVE_ZONES_MEDELLIN,
  medellín: ALTERNATIVE_ZONES_MEDELLIN,
  cartagena: ALTERNATIVE_ZONES_CARTAGENA,
};

function normalizeKey(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, ''); // sacar tildes
}

function getAlternativesFor(city: string, neighborhood: string): string[] {
  const cityMap = ALTERNATIVE_ZONES_BY_CITY[normalizeKey(city)];
  if (!cityMap) return [];
  return cityMap[normalizeKey(neighborhood)] ?? [];
}

// ============================================================================
// findAlternativeZones — una sola query agrupada
// ============================================================================

export interface FindAlternativeZonesInput {
  city: string;
  original_neighborhood: string;
  property_type?: 'apartamento' | 'casa' | 'oficina' | 'lote';
  listing_type?: 'venta' | 'arriendo';
  min_price?: number;
  max_price?: number;
  /** Cuántas propiedades sample por zona alternativa. Default 3, máx 5. */
  samples_per_zone?: number;
}

export interface AlternativeZoneSummary {
  neighborhood: string;
  count: number;
  avg_price_cop: number | null;
  min_price_cop: number | null;
  max_price_cop: number | null;
  avg_price_per_m2: number | null;
  /** 2-3 properties para que la AI tenga material concreto que mostrar. */
  sample_properties: Array<{
    id: string;
    title: string;
    price_cop: number;
    bedrooms: number | null;
    bathrooms: number | null;
    area_m2: number | null;
    source_portal: string;
    source_url: string;
  }>;
}

export interface FindAlternativeZonesResult {
  city: string;
  original_neighborhood: string;
  /** Cantidad de propiedades en el barrio original con los mismos filtros. */
  original_count: number;
  /** Lista de zonas alternativas con datos reales. Ordenadas por count desc. */
  alternatives: AlternativeZoneSummary[];
  /** Si no tenemos mapping para esta ciudad/barrio. */
  warning?: string;
}

export async function findAlternativeZones(
  input: FindAlternativeZonesInput
): Promise<FindAlternativeZonesResult> {
  const sb = getClient();
  const samplesPerZone = Math.min(Math.max(input.samples_per_zone ?? 3, 1), 5);

  // 1. Resolver mapping → lista de barrios alternativos.
  const alternativeNames = getAlternativesFor(input.city, input.original_neighborhood);
  if (alternativeNames.length === 0) {
    return {
      city: input.city,
      original_neighborhood: input.original_neighborhood,
      original_count: 0,
      alternatives: [],
      warning: `Sin mapping de zonas alternativas para "${input.original_neighborhood}" en ${input.city}. Usá searchProperties con otros barrios o ampliá presupuesto.`,
    };
  }

  // 2. Una sola query: trae propiedades del barrio original + alternativos.
  // La filtramos por property_type, listing_type, rango de precio para que
  // los resultados tengan el mismo perfil que el user pidió.
  const allNeighborhoods = [input.original_neighborhood, ...alternativeNames];

  let q = sb
    .from('properties')
    .select(
      'id, title, price_cop, bedrooms, bathrooms, area_m2, neighborhood, source_portal, source_url'
    )
    .eq('city', input.city)
    .eq('is_duplicate', false)
    .in('neighborhood', allNeighborhoods);
  if (input.property_type) q = q.eq('property_type', input.property_type);
  if (input.listing_type) q = q.eq('listing_type', input.listing_type);
  if (input.min_price !== undefined) q = q.gte('price_cop', input.min_price);
  if (input.max_price !== undefined) q = q.lte('price_cop', input.max_price);

  const { data, error } = await q.limit(500);
  if (error) {
    throw new Error(`findAlternativeZones query failed: ${error.message}`);
  }

  const rows = (data ?? []) as Array<{
    id: string;
    title: string;
    price_cop: number;
    bedrooms: number | null;
    bathrooms: number | null;
    area_m2: number | null;
    neighborhood: string | null;
    source_portal: string;
    source_url: string;
  }>;

  // 3. Agrupar por barrio (case-insensitive). neighborhood está canonical en la DB.
  const buckets = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!r.neighborhood) continue;
    const key = normalizeKey(r.neighborhood);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(r);
  }

  // Original count (mismo neighborhood pedido).
  const originalKey = normalizeKey(input.original_neighborhood);
  const originalCount = buckets.get(originalKey)?.length ?? 0;

  // 4. Construir summary por cada zona alternativa CON DATA.
  const alternatives: AlternativeZoneSummary[] = [];
  for (const altName of alternativeNames) {
    const key = normalizeKey(altName);
    const bucket = buckets.get(key) ?? [];
    if (bucket.length === 0) continue; // sin propiedades en el rango → skip

    const prices = bucket.map((p) => p.price_cop);
    const avg = Math.round(prices.reduce((s, p) => s + p, 0) / prices.length);
    const min = Math.min(...prices);
    const max = Math.max(...prices);

    // Avg price/m² solo con los que tienen área conocida y >10m² (defensa
    // contra ruido).
    const withArea = bucket.filter((p) => p.area_m2 && p.area_m2 > 10);
    const avgPm2 =
      withArea.length >= 2
        ? Math.round(
            withArea.reduce((s, p) => s + p.price_cop / (p.area_m2 as number), 0) /
              withArea.length
          )
        : null;

    // Samples: ordenar por proximity al medio del rango pedido (mejor match).
    const target =
      input.min_price !== undefined && input.max_price !== undefined
        ? (input.min_price + input.max_price) / 2
        : avg;
    const sorted = [...bucket].sort(
      (a, b) => Math.abs(a.price_cop - target) - Math.abs(b.price_cop - target)
    );
    const samples = sorted.slice(0, samplesPerZone).map((p) => ({
      id: p.id,
      title: p.title,
      price_cop: p.price_cop,
      bedrooms: p.bedrooms,
      bathrooms: p.bathrooms,
      area_m2: p.area_m2,
      source_portal: p.source_portal,
      source_url: p.source_url,
    }));

    alternatives.push({
      // Usar el name canónico del mapping (no el de la fila — puede tener
      // capitalización rara).
      neighborhood: altName,
      count: bucket.length,
      avg_price_cop: avg,
      min_price_cop: min,
      max_price_cop: max,
      avg_price_per_m2: avgPm2,
      sample_properties: samples,
    });
  }

  // 5. Ordenar alternativas por count desc (las que más opciones tienen primero).
  alternatives.sort((a, b) => b.count - a.count);

  return {
    city: input.city,
    original_neighborhood: input.original_neighborhood,
    original_count: originalCount,
    alternatives,
    warning:
      alternatives.length === 0
        ? 'Las zonas vecinas tampoco tienen propiedades en este rango. Probablemente convenga ampliar presupuesto o cambiar criterios.'
        : undefined,
  };
}
