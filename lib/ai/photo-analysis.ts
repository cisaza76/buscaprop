// lib/ai/photo-analysis.ts
// Análisis visual de fotos del listing con Claude Vision (claude-haiku-4-5).
// Genera descriptores OBJETIVOS y verificables — nunca afirmaciones temporales
// (ej: "renovada hace 5 años") ni de problemas estructurales (humedad, grietas,
// instalaciones). Esos son riesgo legal real si la AI se equivoca.
//
// Cache: tabla photo_analyses (migration 009). Cada (property, photo_url) se
// analiza una sola vez por modelo. Cuando la foto cambia de URL, el cache
// expira naturalmente.

import Anthropic from '@anthropic-ai/sdk';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ============================================================================
// Types
// ============================================================================

export type LightLevel = 'high' | 'medium' | 'low' | 'unclear';
export type Appearance = 'pristine' | 'well_kept' | 'lived_in' | 'needs_work' | 'unclear';
export type Style = 'modern' | 'classic' | 'transitional' | 'industrial' | 'unclear';
export type Furnished = 'fully' | 'partial' | 'empty' | 'unclear';
export type KitchenType = 'open' | 'closed' | 'island' | 'galley' | 'unclear' | 'not_visible';
export type FloorType = 'wood' | 'porcelain' | 'tile' | 'carpet' | 'concrete' | 'unclear';
export type ViewType =
  | 'urban'
  | 'park_or_green'
  | 'mountain'
  | 'interior_courtyard'
  | 'street_level'
  | 'unclear'
  | 'not_visible';

/**
 * Análisis de UNA foto. Todos los campos pueden ser 'unclear' o 'not_visible'
 * — la AI debe ser honesta sobre lo que NO puede ver, no inventar.
 */
export interface PhotoAnalysis {
  light_level: LightLevel;
  appearance: Appearance;
  style: Style;
  furnished: Furnished;
  kitchen_type: KitchenType;
  floor_type: FloorType;
  view_type: ViewType;
  /**
   * Features visibles concretas y verificables. Cada una debe ser
   * descriptiva, NO interpretativa. Ej:
   *   ✅ "ventanal grande", "pisos de madera natural", "cocina con isla"
   *   ❌ "buena iluminación natural" (uses light_level), "ambiente acogedor"
   * Limitamos a 5 items max para mantenerlo señalero, no exhaustivo.
   */
  visible_features: string[];
  /**
   * Una oración corta describiendo el espacio. Tono descriptivo, no
   * comercial. Ej: "Sala amplia con ventanal y comedor anexo." NO:
   * "Hermoso espacio para disfrutar en familia."
   */
  notes: string;
  /**
   * Qué tipo de espacio se ve en la foto.
   */
  room_type:
    | 'living_room'
    | 'kitchen'
    | 'bedroom'
    | 'bathroom'
    | 'dining_room'
    | 'balcony'
    | 'building_facade'
    | 'common_area'
    | 'other';
}

/**
 * Análisis agregado a nivel propiedad (mergeo de todas las fotos).
 */
export interface AggregatedPhotoAnalysis {
  photos_analyzed: number;
  /** Promedio simple de los light_level (descartando 'unclear'). */
  light_level_overall: LightLevel;
  /** El appearance más conservador entre las fotos. */
  appearance_overall: Appearance;
  /** Style dominante (mode). */
  style_overall: Style;
  /** True si alguna foto muestra mobiliario, false si todas vacías. */
  furnished_overall: Furnished;
  /** Set único de features visibles agregadas. */
  visible_features: string[];
  /** Tipos de habitación que se vieron — útil para confirmar specs. */
  rooms_seen: string[];
  /** 2-3 oraciones de descripción overall. */
  summary: string;
}

export interface PropertyPhotoAnalysisResult {
  property_id: string;
  photos: Array<{ photo_url: string; analysis: PhotoAnalysis }>;
  aggregate: AggregatedPhotoAnalysis | null;
  warning?: string;
  /** Total tokens consumidos en este request (excluye cache hits). */
  tokens_used: { input: number; output: number };
}

// ============================================================================
// Implementación
// ============================================================================

const MODEL = 'claude-haiku-4-5';
const MODEL_VERSION = `${MODEL}/v1`; // bump para invalidar cache global.
const MAX_PHOTOS_PER_PROPERTY = 8;
const MAX_TOKENS = 800; // 400-500 típico, holgura para casos complejos.

let cachedAnthropic: Anthropic | null = null;
function getAnthropicClient(): Anthropic {
  if (cachedAnthropic) return cachedAnthropic;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Falta ANTHROPIC_API_KEY');
  cachedAnthropic = new Anthropic({ apiKey });
  return cachedAnthropic;
}

let cachedSupabase: SupabaseClient | null = null;
function getSupabaseClient(): SupabaseClient {
  if (cachedSupabase) return cachedSupabase;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Faltan SUPABASE_URL / SERVICE_ROLE_KEY');
  cachedSupabase = createClient(url, key, { auth: { persistSession: false } });
  return cachedSupabase;
}

/**
 * System prompt para la AI Vision. Muy explícito sobre QUÉ NO afirmar.
 */
const VISION_SYSTEM_PROMPT = `Sos un analista visual de propiedades inmobiliarias. Tu trabajo: extraer descriptores OBJETIVOS de una foto.

REGLAS DURAS — leelas dos veces:

1. SOLO afirmá lo que es DIRECTAMENTE VERIFICABLE en la imagen. Si dudás, usá 'unclear' o 'not_visible'.

2. NUNCA hagas estas afirmaciones (incluso con "parece" o "aproximadamente"):
   - Antigüedad de la propiedad o de las renovaciones (NO "renovada hace ~5 años", NO "construcción de los 80s")
   - Humedad, filtraciones, manchas de agua
   - Grietas estructurales o problemas del edificio
   - Calidad del cableado eléctrico o tuberías
   - Calidad real de los materiales ("este mármol es bueno", "el granito es de baja calidad")
   - Estado de seguridad de la zona o el edificio
   - Cualquier estimación de costo (de renovación, de mejoras, etc.)

3. Tu tono es DESCRIPTIVO, no comercial. Mal: "Hermoso espacio acogedor". Bien: "Sala con ventanal y piso de madera."

4. Las features visibles deben ser concretas y limitadas. Mal: "buena iluminación" (usá light_level). Bien: "ventanal de 2m", "isla de cocina con campana".

5. Si una sección de la foto está oscura, borrosa o tapada, marcala como 'unclear'. NO inferas.

OUTPUT FORMAT — devolvé SOLO un JSON válido (sin markdown, sin bloque \`\`\`), con esta shape exacta:

{
  "light_level": "high" | "medium" | "low" | "unclear",
  "appearance": "pristine" | "well_kept" | "lived_in" | "needs_work" | "unclear",
  "style": "modern" | "classic" | "transitional" | "industrial" | "unclear",
  "furnished": "fully" | "partial" | "empty" | "unclear",
  "kitchen_type": "open" | "closed" | "island" | "galley" | "unclear" | "not_visible",
  "floor_type": "wood" | "porcelain" | "tile" | "carpet" | "concrete" | "unclear",
  "view_type": "urban" | "park_or_green" | "mountain" | "interior_courtyard" | "street_level" | "unclear" | "not_visible",
  "visible_features": [string, ...max 5],
  "notes": "una oración corta, max 20 palabras, descriptiva",
  "room_type": "living_room" | "kitchen" | "bedroom" | "bathroom" | "dining_room" | "balcony" | "building_facade" | "common_area" | "other"
}

Importante: appearance="needs_work" SOLO si hay daños visibles obvios (paredes rotas, mobiliario destrozado). NO uses ese valor por estilo "viejo" — eso va en style.`;

/**
 * Analiza una foto individual. Devuelve { analysis, usage } — cache se maneja
 * a nivel orchestrator (analyzePropertyPhotos), no acá.
 */
async function analyzeSinglePhoto(
  photoUrl: string
): Promise<{ analysis: PhotoAnalysis; usage: { input_tokens: number; output_tokens: number } }> {
  const client = getAnthropicClient();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [
      {
        type: 'text',
        text: VISION_SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'url', url: photoUrl },
          },
          {
            type: 'text',
            text: 'Analizá esta foto y devolvé el JSON con los descriptores.',
          },
        ],
      },
    ],
  });

  // Extraer texto.
  const textBlock = response.content.find(
    (b): b is Anthropic.TextBlock => b.type === 'text'
  );
  if (!textBlock) throw new Error('Sin respuesta de texto del modelo');

  const raw = textBlock.text.trim();
  let parsed: unknown;
  try {
    // Robustness: a veces el modelo añade markdown wrapper aún cuando le dijimos que no.
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '');
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `Respuesta del modelo no es JSON válido: ${raw.slice(0, 200)}... (${
        err instanceof Error ? err.message : err
      })`
    );
  }

  const analysis = normalizeAnalysis(parsed);
  return {
    analysis,
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    },
  };
}

/**
 * Valida y normaliza la respuesta del modelo. Cualquier valor inválido se
 * coerce a 'unclear' / 'not_visible' / array vacío. Nunca tira excepción
 * por shape — solo devuelve un PhotoAnalysis válido.
 */
function normalizeAnalysis(raw: unknown): PhotoAnalysis {
  const r = (raw as Record<string, unknown>) ?? {};
  const oneOf = <T extends string>(allowed: T[], v: unknown, fallback: T): T =>
    typeof v === 'string' && (allowed as string[]).includes(v) ? (v as T) : fallback;

  const features = Array.isArray(r.visible_features)
    ? (r.visible_features as unknown[]).filter((x) => typeof x === 'string').slice(0, 5) as string[]
    : [];

  const notes = typeof r.notes === 'string' ? r.notes.slice(0, 200) : '';

  return {
    light_level: oneOf(['high', 'medium', 'low', 'unclear'], r.light_level, 'unclear'),
    appearance: oneOf(
      ['pristine', 'well_kept', 'lived_in', 'needs_work', 'unclear'],
      r.appearance,
      'unclear'
    ),
    style: oneOf(['modern', 'classic', 'transitional', 'industrial', 'unclear'], r.style, 'unclear'),
    furnished: oneOf(['fully', 'partial', 'empty', 'unclear'], r.furnished, 'unclear'),
    kitchen_type: oneOf(
      ['open', 'closed', 'island', 'galley', 'unclear', 'not_visible'],
      r.kitchen_type,
      'not_visible'
    ),
    floor_type: oneOf(
      ['wood', 'porcelain', 'tile', 'carpet', 'concrete', 'unclear'],
      r.floor_type,
      'unclear'
    ),
    view_type: oneOf(
      [
        'urban',
        'park_or_green',
        'mountain',
        'interior_courtyard',
        'street_level',
        'unclear',
        'not_visible',
      ],
      r.view_type,
      'not_visible'
    ),
    visible_features: features,
    notes,
    room_type: oneOf(
      [
        'living_room',
        'kitchen',
        'bedroom',
        'bathroom',
        'dining_room',
        'balcony',
        'building_facade',
        'common_area',
        'other',
      ],
      r.room_type,
      'other'
    ),
  };
}

/**
 * Orquestador principal. Carga las fotos del listing, consulta cache, analiza
 * lo no cacheado, persiste, y devuelve el agregado.
 */
export async function analyzePropertyPhotos(
  propertyId: string,
  options: { force?: boolean } = {}
): Promise<PropertyPhotoAnalysisResult> {
  const sb = getSupabaseClient();

  // 1. Cargar propiedad.
  const { data: prop, error: propErr } = await sb
    .from('properties')
    .select('id, photos')
    .eq('id', propertyId)
    .maybeSingle();
  if (propErr) throw new Error(`fetch property failed: ${propErr.message}`);
  if (!prop) {
    return {
      property_id: propertyId,
      photos: [],
      aggregate: null,
      warning: `Propiedad ${propertyId} no encontrada.`,
      tokens_used: { input: 0, output: 0 },
    };
  }

  const photoUrls: string[] = Array.isArray(prop.photos)
    ? (prop.photos as string[]).filter((u) => typeof u === 'string').slice(0, MAX_PHOTOS_PER_PROPERTY)
    : [];

  if (photoUrls.length === 0) {
    return {
      property_id: propertyId,
      photos: [],
      aggregate: null,
      warning: 'La propiedad no tiene fotos para analizar.',
      tokens_used: { input: 0, output: 0 },
    };
  }

  // 2. Consultar cache. Si force=true, saltamos cache.
  let cached: Array<{ photo_url: string; analysis: PhotoAnalysis }> = [];
  if (!options.force) {
    const { data: hits, error: cacheErr } = await sb
      .from('photo_analyses')
      .select('photo_url, analysis')
      .eq('property_id', propertyId)
      .eq('model_version', MODEL_VERSION)
      .in('photo_url', photoUrls);
    if (!cacheErr && hits) {
      cached = (hits as Array<{ photo_url: string; analysis: unknown }>).map((h) => ({
        photo_url: h.photo_url,
        analysis: normalizeAnalysis(h.analysis),
      }));
    }
  }
  const cachedSet = new Set(cached.map((c) => c.photo_url));
  const toAnalyze = photoUrls.filter((u) => !cachedSet.has(u));

  // 3. Analizar las nuevas. En paralelo (Vision puede manejarlo, son requests
  // independientes). Limitamos a Promise.allSettled para tolerar fallas.
  const results: Array<{ photo_url: string; analysis: PhotoAnalysis }> = [...cached];
  const totalUsage = { input: 0, output: 0 };

  const analyses = await Promise.allSettled(
    toAnalyze.map(async (url) => {
      const r = await analyzeSinglePhoto(url);
      return { url, ...r };
    })
  );

  for (const res of analyses) {
    if (res.status === 'fulfilled') {
      const { url, analysis, usage } = res.value;
      results.push({ photo_url: url, analysis });
      totalUsage.input += usage.input_tokens;
      totalUsage.output += usage.output_tokens;

      // Persistir en cache (best-effort — si falla, log + sigue).
      const { error: insertErr } = await sb.from('photo_analyses').upsert(
        {
          property_id: propertyId,
          photo_url: url,
          analysis,
          model_version: MODEL_VERSION,
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
        },
        { onConflict: 'property_id,photo_url' }
      );
      if (insertErr) {
        const msg = insertErr.message ?? '';
        if (!/does not exist/i.test(msg) && !/could not find.*table/i.test(msg)) {
          console.warn(`[photo_analyses] cache write failed: ${msg}`);
        }
        // Si no existe la tabla, descartamos silenciosamente — la migration
        // 009 se aplica después; el análisis se computa cada vez hasta entonces.
      }
    } else {
      console.warn(`[analyzePhoto] failed: ${res.reason}`);
    }
  }

  // 4. Agregado.
  const aggregate = results.length > 0 ? aggregatePhotos(results.map((r) => r.analysis)) : null;

  return {
    property_id: propertyId,
    photos: results,
    aggregate,
    tokens_used: totalUsage,
  };
}

/**
 * Mergeo simple para producir un overall a nivel propiedad.
 */
function aggregatePhotos(analyses: PhotoAnalysis[]): AggregatedPhotoAnalysis {
  const lightOrder: LightLevel[] = ['low', 'medium', 'high'];
  const appearanceOrder: Appearance[] = ['needs_work', 'lived_in', 'well_kept', 'pristine'];

  // light_level: promedio simple (mode entre las que NO son 'unclear').
  const lightLevels = analyses.map((a) => a.light_level).filter((l) => l !== 'unclear');
  const avgLightIdx =
    lightLevels.length > 0
      ? Math.round(
          lightLevels.reduce((s, l) => s + lightOrder.indexOf(l as LightLevel), 0) /
            lightLevels.length
        )
      : -1;
  const light_level_overall: LightLevel = avgLightIdx >= 0 ? lightOrder[avgLightIdx] : 'unclear';

  // appearance: el MÁS conservador entre las fotos (peor caso). Si hay una
  // foto que muestra "needs_work", ese es el overall — no le mentimos al user.
  const appearances = analyses
    .map((a) => a.appearance)
    .filter((a) => a !== 'unclear');
  const minAppearanceIdx =
    appearances.length > 0
      ? Math.min(...appearances.map((a) => appearanceOrder.indexOf(a as Appearance)))
      : -1;
  const appearance_overall: Appearance =
    minAppearanceIdx >= 0 ? appearanceOrder[minAppearanceIdx] : 'unclear';

  // style: mode.
  const styleCounts = new Map<Style, number>();
  for (const a of analyses) {
    if (a.style !== 'unclear') styleCounts.set(a.style, (styleCounts.get(a.style) ?? 0) + 1);
  }
  let style_overall: Style = 'unclear';
  let maxCount = 0;
  for (const [s, c] of styleCounts) {
    if (c > maxCount) {
      style_overall = s;
      maxCount = c;
    }
  }

  // furnished: si CUALQUIER foto interior muestra mobiliario, partial al menos.
  const interiorAnalyses = analyses.filter(
    (a) => a.room_type !== 'building_facade' && a.room_type !== 'common_area'
  );
  const hasFully = interiorAnalyses.some((a) => a.furnished === 'fully');
  const hasPartial = interiorAnalyses.some((a) => a.furnished === 'partial');
  const allEmpty =
    interiorAnalyses.length > 0 &&
    interiorAnalyses.every((a) => a.furnished === 'empty');
  const furnished_overall: Furnished = hasFully
    ? 'fully'
    : hasPartial
    ? 'partial'
    : allEmpty
    ? 'empty'
    : 'unclear';

  // visible_features: union (deduplicado, max 8).
  const featureSet = new Set<string>();
  for (const a of analyses) {
    for (const f of a.visible_features) featureSet.add(f);
  }
  const visible_features = Array.from(featureSet).slice(0, 8);

  // rooms_seen: union.
  const roomsSeen = Array.from(new Set(analyses.map((a) => a.room_type)));

  // summary: armado a partir de los signals (no llamamos al modelo otra vez —
  // ahorramos tokens y evitamos otra fuente de invención).
  const summary = buildSummary({
    light: light_level_overall,
    appearance: appearance_overall,
    style: style_overall,
    furnished: furnished_overall,
    photoCount: analyses.length,
    rooms: roomsSeen,
  });

  return {
    photos_analyzed: analyses.length,
    light_level_overall,
    appearance_overall,
    style_overall,
    furnished_overall,
    visible_features,
    rooms_seen: roomsSeen,
    summary,
  };
}

function buildSummary(s: {
  light: LightLevel;
  appearance: Appearance;
  style: Style;
  furnished: Furnished;
  photoCount: number;
  rooms: string[];
}): string {
  const parts: string[] = [];

  if (s.light === 'high') parts.push('Espacios con buena luz natural.');
  else if (s.light === 'low') parts.push('Iluminación limitada en las fotos disponibles.');

  const styleMap: Record<Style, string> = {
    modern: 'Acabados de estilo moderno.',
    classic: 'Acabados de estilo clásico.',
    transitional: 'Estilo transicional (mezcla moderno/clásico).',
    industrial: 'Estética industrial.',
    unclear: '',
  };
  if (styleMap[s.style]) parts.push(styleMap[s.style]);

  const appearanceMap: Record<Appearance, string> = {
    pristine: 'Inmueble en muy buen estado visible.',
    well_kept: 'Inmueble visiblemente bien mantenido.',
    lived_in: 'Habitado, sin daños evidentes.',
    needs_work: 'Algunas zonas se ven con desgaste visible.',
    unclear: '',
  };
  if (appearanceMap[s.appearance]) parts.push(appearanceMap[s.appearance]);

  if (s.furnished === 'fully') parts.push('Aparece amoblado en las fotos.');
  else if (s.furnished === 'empty') parts.push('Aparece vacío.');

  if (parts.length === 0) {
    parts.push(`Análisis de ${s.photoCount} foto(s) completado.`);
  }

  parts.push(
    'Estos son descriptores visuales; una visita confirma estado real, instalaciones y dimensiones.'
  );

  return parts.join(' ');
}
