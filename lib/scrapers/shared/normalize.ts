// lib/scrapers/shared/normalize.ts
// Helpers para limpiar y normalizar campos extraídos por los scrapers.

import type { PropertyType, ListingType } from './types';

// "$ 208.000.000,00" → 208000000. Acepta variantes: con/sin $, con espacios,
// con &nbsp;, con coma decimal "es-CO" o punto decimal "en-US".
export function parseCOP(input: string | number | null | undefined): number | null {
  if (input == null) return null;
  if (typeof input === 'number') return Math.round(input);

  // Quitar todo excepto dígitos, comas y puntos.
  const cleaned = input
    .replace(/&nbsp;/g, ' ')
    .replace(/[^\d,.\s]/g, '')
    .trim();

  if (!cleaned) return null;

  // Heurística para COP (siempre pesos enteros, no centavos):
  //   - Si hay coma: formato es-CO "208.000.000,00" → puntos=miles, coma=decimal
  //   - Si NO hay coma: todos los puntos son separadores de miles
  //     (cubre "509.430.000" y "$1.350.000.000" sin tratar el último '.' como decimal)
  let normalized: string;
  if (cleaned.includes(',')) {
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else {
    normalized = cleaned.replace(/\./g, '');
  }

  const n = Number(normalized);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

export function parseInteger(input: string | number | null | undefined): number | null {
  if (input == null) return null;
  if (typeof input === 'number') return Math.round(input);
  const m = input.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

export function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

// Mapeos de strings de portales → enum de la BD. Cada portal usa nombres
// ligeramente distintos ("apto", "casa", "bodega") — añadir aquí cuando
// aparezcan.
const PROPERTY_TYPE_MAP: Record<string, PropertyType> = {
  apartamento: 'apartamento',
  apto: 'apartamento',
  apartaestudio: 'apartamento',
  studio: 'apartamento',
  casa: 'casa',
  oficina: 'oficina',
  local: 'oficina',
  consultorio: 'oficina',
  lote: 'lote',
  terreno: 'lote',
  finca: 'lote',
};

export function mapPropertyType(raw: string | null | undefined): PropertyType | null {
  if (!raw) return null;
  const key = raw.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  for (const [k, v] of Object.entries(PROPERTY_TYPE_MAP)) {
    if (key.includes(k)) return v;
  }
  return null;
}

const LISTING_TYPE_MAP: Record<string, ListingType> = {
  venta: 'venta',
  vender: 'venta',
  comprar: 'venta',
  arriendo: 'arriendo',
  alquiler: 'arriendo',
  arrendar: 'arriendo',
  rentar: 'arriendo',
};

export function mapListingType(raw: string | null | undefined): ListingType | null {
  if (!raw) return null;
  const key = raw.toLowerCase().trim();
  for (const [k, v] of Object.entries(LISTING_TYPE_MAP)) {
    if (key.includes(k)) return v;
  }
  return null;
}

// Normaliza ciudades a nombres canónicos del schema (con tildes).
const CITY_CANONICAL: Record<string, string> = {
  bogota: 'Bogotá',
  'bogota dc': 'Bogotá',
  'bogota d c': 'Bogotá',
  'bogota d.c.': 'Bogotá',
  medellin: 'Medellín',
  cali: 'Cali',
  barranquilla: 'Barranquilla',
  cartagena: 'Cartagena',
  bucaramanga: 'Bucaramanga',
  pereira: 'Pereira',
};

export function canonicalCity(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const k = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\./g, '') // "bogota d.c." → "bogota dc"
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return CITY_CANONICAL[k] ?? raw.trim();
}
