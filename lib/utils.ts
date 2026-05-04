// lib/utils.ts
// Helpers de formato y display para la UI.

const PORTAL_LABELS: Record<string, string> = {
  fincaraiz: 'Fincaraíz',
  metrocuadrado: 'MetroCuadrado',
  properati: 'Properati',
  ciencuadras: 'Ciencuadras',
};

const PROPERTY_TYPE_LABELS: Record<string, string> = {
  apartamento: 'Apartamento',
  casa: 'Casa',
  oficina: 'Oficina',
  lote: 'Lote',
};

const LISTING_TYPE_LABELS: Record<string, string> = {
  venta: 'Venta',
  arriendo: 'Arriendo',
};

export const COLOMBIAN_CITIES = [
  'Bogotá',
  'Medellín',
  'Cali',
  'Barranquilla',
  'Cartagena',
  'Bucaramanga',
  'Pereira',
];

export function formatCOP(amount: number | null | undefined): string {
  if (amount == null) return '—';
  return `$${new Intl.NumberFormat('es-CO').format(amount)}`;
}

export function formatCOPShort(amount: number | null | undefined): string {
  if (amount == null) return '—';
  if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(1).replace('.0', '')}MM`;
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(0)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${amount}`;
}

export function portalLabel(portal: string): string {
  return PORTAL_LABELS[portal] ?? portal;
}

export function propertyTypeLabel(type: string): string {
  return PROPERTY_TYPE_LABELS[type] ?? type;
}

export function listingTypeLabel(type: string): string {
  return LISTING_TYPE_LABELS[type] ?? type;
}

export function formatDateES(iso: string): string {
  return new Date(iso).toLocaleDateString('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

// Normaliza para comparaciones case+acentos-insensibles ("bogota" ≈ "Bogotá").
function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export type ParsedQueryFilters = {
  city?: string;
  property_type?: 'apartamento' | 'casa' | 'oficina' | 'lote';
  listing_type?: 'venta' | 'arriendo';
  min_bedrooms?: number;
};

// Parser de lenguaje natural para la SearchBar.
// Ej: "Apartamento 3 hab Bogotá arriendo" → { property_type, min_bedrooms, city, listing_type }.
export function parseSearchQuery(query: string): ParsedQueryFilters {
  if (!query.trim()) return {};
  const haystack = ` ${normalize(query)} `;
  const out: ParsedQueryFilters = {};

  for (const city of COLOMBIAN_CITIES) {
    if (haystack.includes(` ${normalize(city)} `) || haystack.includes(` ${normalize(city)},`)) {
      out.city = city;
      break;
    }
  }

  if (/\b(apartamento|apto|aptos)\b/.test(haystack)) out.property_type = 'apartamento';
  else if (/\bcasa(s)?\b/.test(haystack)) out.property_type = 'casa';
  else if (/\boficina(s)?\b/.test(haystack)) out.property_type = 'oficina';
  else if (/\blote(s)?\b/.test(haystack)) out.property_type = 'lote';

  if (/\barriendo|arrendar|alquiler|rentar?\b/.test(haystack)) out.listing_type = 'arriendo';
  else if (/\bventa|comprar|vender\b/.test(haystack)) out.listing_type = 'venta';

  const bedroomMatch = haystack.match(/\b(\d+)\s*(habitacion(es)?|hab|alcoba(s)?|cuarto(s)?)\b/);
  if (bedroomMatch) {
    const n = Number(bedroomMatch[1]);
    if (n > 0 && n <= 10) out.min_bedrooms = n;
  }

  return out;
}
