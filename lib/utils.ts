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
