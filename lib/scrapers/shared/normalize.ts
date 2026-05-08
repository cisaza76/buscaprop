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
// La key se busca con casefold (ver canonicalCity): minúsculas, sin tildes,
// sin puntuación. Por eso aparecen variantes como 'bogota d c' (sin punto).
//
// Casos cubiertos:
//   1. Capitales y ciudades grandes (bogota → Bogotá, etc.)
//   2. Aliases obvios (cartagena de indias → Cartagena)
//   3. Municipios Antioquia que el parser de fincaraiz devuelve en lowercase
//      (envigado, sabaneta, etc.) por culpa de un bug que extrae la última
//      palabra del slug — ver normalize-test/audit-city-casing.ts
//   4. Bugs específicos del slug: "san vicente" → city='vicente', etc.
//      Mapeamos al canonical aunque sea ligeramente impreciso (ej. "san miguel"
//      sin departamento) — mejor que dejar lowercase basura.
const CITY_CANONICAL: Record<string, string> = {
  // Capitales / áreas metropolitanas grandes
  bogota: 'Bogotá',
  'bogota dc': 'Bogotá',
  'bogota d c': 'Bogotá',
  'bogota d.c.': 'Bogotá',
  medellin: 'Medellín',
  cali: 'Cali',
  'santiago de cali': 'Cali',
  barranquilla: 'Barranquilla',
  cartagena: 'Cartagena',
  'cartagena de indias': 'Cartagena',
  bucaramanga: 'Bucaramanga',
  pereira: 'Pereira',
  'santa marta': 'Santa Marta',
  manizales: 'Manizales',
  ibague: 'Ibagué',
  cucuta: 'Cúcuta',
  villavicencio: 'Villavicencio',
  popayan: 'Popayán',
  pasto: 'Pasto',
  monteria: 'Montería',
  neiva: 'Neiva',

  // Antioquia (área metropolitana del Valle de Aburrá + cercanos)
  envigado: 'Envigado',
  rionegro: 'Rionegro',
  sabaneta: 'Sabaneta',
  retiro: 'El Retiro',
  bello: 'Bello',
  ceja: 'La Ceja',
  itagui: 'Itagüí',
  guarne: 'Guarne',
  estrella: 'La Estrella',
  copacabana: 'Copacabana',
  marinilla: 'Marinilla',
  girardota: 'Girardota',
  amaga: 'Amagá',
  caldas: 'Caldas',
  barbosa: 'Barbosa',
  carepa: 'Carepa',
  apartado: 'Apartadó',

  // Multi-palabra que el parser fincaraiz parte mal (bug):
  // - "santafe de antioquia" → city='antioquia'
  // - "san vicente"          → city='vicente'
  // - "san jeronimo"          → city='jeronimo'
  // - "san miguel"            → city='miguel'
  // - "el carmen de viboral"  → city='viboral'
  // Aquí los mapeamos al canonical aunque venga el último token solo.
  antioquia: 'Santa Fe de Antioquia',
  'santafe de antioquia': 'Santa Fe de Antioquia',
  'santa fe de antioquia': 'Santa Fe de Antioquia',
  vicente: 'San Vicente Ferrer',
  'san vicente': 'San Vicente Ferrer',
  'san vicente ferrer': 'San Vicente Ferrer',
  jeronimo: 'San Jerónimo',
  'san jeronimo': 'San Jerónimo',
  miguel: 'San Miguel',
  'san miguel': 'San Miguel',
  viboral: 'El Carmen de Viboral',
  'el carmen de viboral': 'El Carmen de Viboral',

  // Valle / otros
  jamundi: 'Jamundí',
  palmira: 'Palmira',
  turbo: 'Turbo',
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
  if (CITY_CANONICAL[k]) return CITY_CANONICAL[k];
  // Fallback: si NO está en el mapping pero viene en lowercase puro y tiene
  // 3+ chars, capitalizar primera letra (defensa contra futuros municipios
  // que el parser saque en lowercase pero no estén en el map).
  const trimmed = raw.trim();
  if (trimmed.length >= 3 && trimmed === trimmed.toLowerCase()) {
    return trimmed[0].toUpperCase() + trimmed.slice(1);
  }
  return trimmed;
}

// Limpia neighborhoods que son leftover del bug del slug-parser de fincaraiz.
// Cuando el parser confunde "san-vicente" como city='vicente' + neighborhood='San',
// el neighborhood queda como basura: "San", "El Carmen De", "Santafe De", etc.
// Estos son sufijos de prefijos de ciudad multi-palabra, no barrios reales.
const LEFTOVER_NEIGHBORHOOD_PATTERNS = [
  /^san$/i,
  /^santa$/i,
  /^santafe$/i,
  /^santafe de$/i,
  /^santa fe de$/i,
  /^el$/i,
  /^la$/i,
  /^el carmen de$/i,
  /^la ceja$/i,
];

export function cleanLeftoverNeighborhood(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  for (const pat of LEFTOVER_NEIGHBORHOOD_PATTERNS) {
    if (pat.test(trimmed)) return null;
  }
  return trimmed;
}

// ============================================================================
// Validación geográfica
// ============================================================================
//
// Bounding box aproximado de Colombia continental + insular. Lo usamos para
// descartar coordenadas que salen "fuera de Colombia" — eso suele ser señal de
// un parser cambiado del portal devolviendo placeholders raros (ej. (0, 0)),
// orden lat/lng invertido, o un valor escapado mal.
//
// Fuente: extremos geográficos según IGAC.
//   - Lat: 4°13'30"S (San Andrés más sur) a 12°27'N (Punta Gallinas)
//   - Lng: 66°50'W (más este) a 81°43'W (San Andrés isla más oeste)
// Damos un margen pequeño por las islas y errores de precisión.
const CO_LAT_MIN = -4.5;
const CO_LAT_MAX = 13;
const CO_LNG_MIN = -82;
const CO_LNG_MAX = -66;

export function isValidColombiaCoord(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat === 0 || lng === 0) return false; // (0, 0) suele ser placeholder.
  return (
    lat >= CO_LAT_MIN && lat <= CO_LAT_MAX && lng >= CO_LNG_MIN && lng <= CO_LNG_MAX
  );
}
