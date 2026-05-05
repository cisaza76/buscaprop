// lib/ai/analytics.ts
// Helpers de análisis para las tools del asesor (Phase 7B reducida).
// Todos los datos vienen de nuestra DB — NUNCA inventamos. Si una métrica
// no se puede calcular con confianza (ej: sample size <5), devolvemos null
// y la AI tiene que omitirla en su respuesta.
//
// Diseño: usamos service_role server-side. Estas funciones SOLO se llaman
// desde executors de tools, no desde el browser.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cachedClient: SupabaseClient | null = null;
function getClient(): SupabaseClient {
  if (cachedClient) return cachedClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Faltan SUPABASE_URL / SERVICE_ROLE_KEY');
  cachedClient = createClient(url, key, { auth: { persistSession: false } });
  return cachedClient;
}

// ============================================================================
// analyzeNeighborhood
// ============================================================================

export interface AnalyzeNeighborhoodInput {
  city: string;
  neighborhood?: string;
  property_type?: 'apartamento' | 'casa' | 'oficina' | 'lote';
  listing_type?: 'venta' | 'arriendo';
  /** Si lo paso, restrinjo el análisis a este rango. Si no, todo el barrio. */
  min_price?: number;
  max_price?: number;
}

export interface AnalyzeNeighborhoodResult {
  /** Filtros que efectivamente se aplicaron (eco para que la AI sepa qué pidió). */
  filters: AnalyzeNeighborhoodInput;
  /** Cantidad de propiedades disponibles que matchean los filtros. */
  total_available: number;
  /** Precio promedio en COP. null si sample size < 5 (no confiable). */
  avg_price_cop: number | null;
  /** Mediana — más robusta a outliers. */
  median_price_cop: number | null;
  /** Precio promedio por m². null si <5 propiedades con área conocida. */
  avg_price_per_m2: number | null;
  /** Distribución por habitaciones, ordenado: { "1": 12, "2": 23, "3": 8 }. */
  bedroom_distribution: Record<string, number>;
  /**
   * % de propiedades con garaje. NOTA: hoy NO tenemos un campo `parking` en
   * properties — devolvemos null como placeholder explícito ("dato no disponible").
   * No inventamos.
   */
  parking_coverage_pct: number | null;
  /** Cuántas propiedades hay por portal — útil para diversidad de fuentes. */
  by_portal: Record<string, number>;
  /**
   * Mensaje de advertencia si el sample es pequeño (n < 10). La AI debe
   * mostrar al user que el análisis es limitado.
   */
  warning?: string;
}

export async function analyzeNeighborhood(
  input: AnalyzeNeighborhoodInput
): Promise<AnalyzeNeighborhoodResult> {
  const sb = getClient();

  let q = sb
    .from('properties')
    .select(
      'price_cop, area_m2, bedrooms, source_portal, neighborhood, city, property_type, listing_type, is_duplicate'
    )
    .eq('city', input.city)
    .eq('is_duplicate', false);

  if (input.neighborhood) q = q.ilike('neighborhood', input.neighborhood);
  if (input.property_type) q = q.eq('property_type', input.property_type);
  if (input.listing_type) q = q.eq('listing_type', input.listing_type);
  if (input.min_price !== undefined) q = q.gte('price_cop', input.min_price);
  if (input.max_price !== undefined) q = q.lte('price_cop', input.max_price);

  // Limit alto para que el AVG sea representativo, pero acotado para no
  // chupar memoria en barrios grandes.
  const { data, error } = await q.limit(2000);
  if (error) throw new Error(`analyzeNeighborhood query failed: ${error.message}`);

  const rows = (data ?? []) as Array<{
    price_cop: number;
    area_m2: number | null;
    bedrooms: number | null;
    source_portal: string;
  }>;

  const total = rows.length;

  // Distribución por habitaciones.
  const bedroomDist: Record<string, number> = {};
  for (const r of rows) {
    if (r.bedrooms == null) continue;
    const key = r.bedrooms >= 4 ? '4+' : String(r.bedrooms);
    bedroomDist[key] = (bedroomDist[key] ?? 0) + 1;
  }

  // Distribución por portal.
  const byPortal: Record<string, number> = {};
  for (const r of rows) {
    byPortal[r.source_portal] = (byPortal[r.source_portal] ?? 0) + 1;
  }

  // Métricas con guardas de sample size.
  let avgPrice: number | null = null;
  let medianPrice: number | null = null;
  let avgPricePerM2: number | null = null;
  if (total >= 5) {
    const prices = rows.map((r) => r.price_cop).sort((a, b) => a - b);
    avgPrice = Math.round(prices.reduce((s, p) => s + p, 0) / prices.length);
    medianPrice = prices[Math.floor(prices.length / 2)];

    const withArea = rows.filter((r) => r.area_m2 && r.area_m2 > 10);
    if (withArea.length >= 5) {
      const ratios = withArea.map((r) => r.price_cop / (r.area_m2 as number));
      avgPricePerM2 = Math.round(ratios.reduce((s, p) => s + p, 0) / ratios.length);
    }
  }

  const result: AnalyzeNeighborhoodResult = {
    filters: input,
    total_available: total,
    avg_price_cop: avgPrice,
    median_price_cop: medianPrice,
    avg_price_per_m2: avgPricePerM2,
    bedroom_distribution: bedroomDist,
    parking_coverage_pct: null, // No tenemos el campo todavía.
    by_portal: byPortal,
  };

  if (total === 0) {
    result.warning = 'No se encontraron propiedades con esos filtros.';
  } else if (total < 10) {
    result.warning = `Sample size pequeño (${total} propiedades). Las métricas son indicativas — un agente humano puede dar mejor contexto.`;
  }

  return result;
}

// ============================================================================
// findComparables
// ============================================================================

export interface FindComparablesInput {
  property_id: string;
  /** Límite de comparables a devolver. Default 5. */
  limit?: number;
}

export interface ComparableProperty {
  id: string;
  title: string;
  price_cop: number;
  city: string;
  neighborhood: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  area_m2: number | null;
  property_type: string;
  listing_type: string;
  source_portal: string;
  source_url: string;
  /** Diferencia % vs la propiedad referencia (negativo = más barato). */
  price_diff_pct: number;
}

export interface FindComparablesResult {
  /** Propiedad de referencia (eco). */
  reference: {
    id: string;
    title: string;
    price_cop: number;
    neighborhood: string | null;
    bedrooms: number | null;
  };
  comparables: ComparableProperty[];
  warning?: string;
}

export async function findComparables(
  input: FindComparablesInput
): Promise<FindComparablesResult> {
  const sb = getClient();
  const limit = Math.min(Math.max(input.limit ?? 5, 1), 10);

  // 1. Cargar la propiedad de referencia.
  const { data: ref, error: refErr } = await sb
    .from('properties')
    .select(
      'id, title, price_cop, city, neighborhood, bedrooms, bathrooms, area_m2, property_type, listing_type'
    )
    .eq('id', input.property_id)
    .maybeSingle();
  if (refErr) throw new Error(`findComparables ref failed: ${refErr.message}`);
  if (!ref) {
    return {
      reference: {
        id: input.property_id,
        title: '(no encontrada)',
        price_cop: 0,
        neighborhood: null,
        bedrooms: null,
      },
      comparables: [],
      warning: `No se encontró la propiedad ${input.property_id}.`,
    };
  }

  // 2. Buscar comparables: mismo city + neighborhood + property_type + listing_type + ±10% precio + mismas habs (±1).
  const minPrice = Math.round(ref.price_cop * 0.9);
  const maxPrice = Math.round(ref.price_cop * 1.1);
  let q = sb
    .from('properties')
    .select(
      'id, title, price_cop, city, neighborhood, bedrooms, bathrooms, area_m2, property_type, listing_type, source_portal, source_url'
    )
    .eq('city', ref.city)
    .eq('property_type', ref.property_type)
    .eq('listing_type', ref.listing_type)
    .eq('is_duplicate', false)
    .gte('price_cop', minPrice)
    .lte('price_cop', maxPrice)
    .neq('id', ref.id);

  if (ref.neighborhood) {
    q = q.ilike('neighborhood', ref.neighborhood);
  }
  if (ref.bedrooms != null) {
    q = q.gte('bedrooms', Math.max(0, ref.bedrooms - 1)).lte('bedrooms', ref.bedrooms + 1);
  }

  const { data, error } = await q.limit(limit);
  if (error) throw new Error(`findComparables query failed: ${error.message}`);

  const comparables: ComparableProperty[] = (data ?? []).map((p) => ({
    id: p.id as string,
    title: p.title as string,
    price_cop: p.price_cop as number,
    city: p.city as string,
    neighborhood: (p.neighborhood as string | null) ?? null,
    bedrooms: (p.bedrooms as number | null) ?? null,
    bathrooms: (p.bathrooms as number | null) ?? null,
    area_m2: (p.area_m2 as number | null) ?? null,
    property_type: p.property_type as string,
    listing_type: p.listing_type as string,
    source_portal: p.source_portal as string,
    source_url: p.source_url as string,
    price_diff_pct: Math.round(((p.price_cop as number) / ref.price_cop - 1) * 100),
  }));

  const result: FindComparablesResult = {
    reference: {
      id: ref.id as string,
      title: ref.title as string,
      price_cop: ref.price_cop as number,
      neighborhood: (ref.neighborhood as string | null) ?? null,
      bedrooms: (ref.bedrooms as number | null) ?? null,
    },
    comparables,
  };

  if (comparables.length === 0) {
    result.warning =
      'No se encontraron comparables con esos filtros (mismo barrio, ±10% precio, ±1 habitación). Esto puede pasar en barrios pequeños o propiedades únicas.';
  } else if (comparables.length < 3) {
    result.warning = `Solo ${comparables.length} comparable(s) — sample limitado.`;
  }

  return result;
}

// ============================================================================
// simulateCredit
// ============================================================================

export interface SimulateCreditInput {
  /** Precio de la propiedad en COP. */
  price_cop: number;
  /** Cuota inicial en COP. Por default 30%. */
  down_payment_cop?: number;
  /** Plazo en años. Default 20, mínimo 5, máximo 30. */
  years?: number;
  /**
   * Tasa anual efectiva (decimal). Si no se pasa, usamos 0.12 (12% E.A.) como
   * referencia pública del mercado colombiano para crédito hipotecario.
   * Esto es ESTIMADO — el banco da la tasa real según perfil del cliente.
   */
  annual_rate?: number;
}

export interface SimulateCreditResult {
  inputs: {
    price_cop: number;
    down_payment_cop: number;
    down_payment_pct: number;
    loan_amount_cop: number;
    years: number;
    annual_rate: number;
  };
  /** Cuota mensual estimada (capital + intereses, sin seguros). */
  monthly_payment_cop: number;
  /** Total intereses pagados al final del plazo. */
  total_interest_cop: number;
  /** Costo total (loan + intereses). */
  total_paid_cop: number;
  /**
   * Disclaimer obligatorio. La AI DEBE incluir este texto al user — no es opcional.
   */
  disclaimer: string;
  warnings: string[];
}

const DEFAULT_RATE = 0.12; // 12% E.A. — referencia mercado COL crédito hipotecario.

export function simulateCredit(input: SimulateCreditInput): SimulateCreditResult {
  const warnings: string[] = [];
  const price = Math.max(0, input.price_cop);
  const downPaymentRaw = input.down_payment_cop ?? Math.round(price * 0.3);
  const downPayment = Math.min(Math.max(0, downPaymentRaw), price);
  if (downPayment !== downPaymentRaw) {
    warnings.push(`Cuota inicial ajustada a $${downPayment} (no puede exceder el precio).`);
  }
  const loan = Math.max(0, price - downPayment);

  let years = input.years ?? 20;
  if (years < 5) {
    warnings.push(`Plazo mínimo 5 años (recibí ${years}). Ajustado a 5.`);
    years = 5;
  } else if (years > 30) {
    warnings.push(`Plazo máximo 30 años (recibí ${years}). Ajustado a 30.`);
    years = 30;
  }

  const annualRate = input.annual_rate ?? DEFAULT_RATE;
  // Convertir tasa efectiva anual → tasa mensual equivalente.
  const monthlyRate = Math.pow(1 + annualRate, 1 / 12) - 1;
  const months = years * 12;

  // Fórmula amortización francesa: M = L * r / (1 - (1+r)^-n)
  let monthlyPayment = 0;
  if (loan > 0 && monthlyRate > 0) {
    monthlyPayment = (loan * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -months));
  } else if (loan > 0) {
    monthlyPayment = loan / months;
  }

  const totalPaid = Math.round(monthlyPayment * months);
  const totalInterest = Math.max(0, totalPaid - loan);

  return {
    inputs: {
      price_cop: price,
      down_payment_cop: downPayment,
      down_payment_pct: price > 0 ? Math.round((downPayment / price) * 100) : 0,
      loan_amount_cop: loan,
      years,
      annual_rate: annualRate,
    },
    monthly_payment_cop: Math.round(monthlyPayment),
    total_interest_cop: totalInterest,
    total_paid_cop: totalPaid,
    disclaimer:
      `Estimación con tasa de referencia del mercado colombiano (~${(annualRate * 100).toFixed(
        1
      )}% E.A.). ` +
      'Tu banco te dará la tasa exacta según perfil crediticio, ingresos y producto. ' +
      'No incluye seguros (vida, hogar, daño material) que típicamente suman 15-25% a la cuota.',
    warnings,
  };
}
