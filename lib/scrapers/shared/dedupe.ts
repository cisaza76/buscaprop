// lib/scrapers/shared/dedupe.ts
// Detección de duplicados cross-portal: si la misma propiedad aparece en
// Fincaraíz y MetroCuadrado, queremos mostrarla una sola vez con un
// canonical_id apuntando al "original".

import { createHash } from 'crypto';
import type { ScrapedProperty } from './types';

// Hash determinístico para comparar propiedades a través de portales.
// NO usamos source_url (cada portal tiene URL distinta para la misma
// propiedad). Combinamos: ciudad + barrio + tipo + habitaciones + área
// (redondeada a 5m²) + precio en banda de ±5%.
export function dedupeHash(p: Pick<
  ScrapedProperty,
  'city' | 'neighborhood' | 'property_type' | 'bedrooms' | 'bathrooms' | 'area_m2' | 'price_cop' | 'listing_type'
>): string {
  const priceBand = priceBandKey(p.price_cop);
  const areaBucket = p.area_m2 ? Math.round(p.area_m2 / 5) * 5 : 0;
  const parts = [
    (p.city ?? '').toLowerCase().trim(),
    (p.neighborhood ?? '').toLowerCase().trim(),
    p.property_type,
    p.listing_type,
    p.bedrooms ?? 0,
    p.bathrooms ?? 0,
    areaBucket,
    priceBand,
  ].join('|');
  return createHash('sha256').update(parts).digest('hex').slice(0, 24);
}

// Agrupa precios en bandas log-escaladas para tolerar diferencias
// pequeñas (±5%) entre portales sin colapsar precios muy distintos.
function priceBandKey(price_cop: number): number {
  if (!price_cop || price_cop <= 0) return 0;
  // log1.05 → cada banda = +5% del anterior.
  return Math.round(Math.log(price_cop) / Math.log(1.05));
}
