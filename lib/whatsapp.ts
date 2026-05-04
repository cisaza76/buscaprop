// lib/whatsapp.ts
// Helper para construir links wa.me con mensaje pre-poblado.
//
// Strategy MVP: número genérico BuscaProp en env var. Cuando ampliemos
// el schema con contact_phone por listing, este helper acepta override.

import type { Property } from './supabase';
import { formatCOP, portalLabel } from './utils';

/**
 * Número WhatsApp genérico de BuscaProp (fallback para todos los listings
 * hasta que tengamos contact_phone por listing). Lee de env var, con
 * fallback hardcoded para que no rompa el build cuando no está seteada.
 *
 * Configurar en .env.local:
 *   NEXT_PUBLIC_BUSCAPROP_WHATSAPP=573001234567   (sin '+', sin espacios)
 */
const FALLBACK_NUMBER = '573001234567'; // TODO: reemplazar con número real

export function getWhatsAppNumber(override?: string | null): string {
  if (override && override.trim()) return normalizePhone(override);
  if (typeof process !== 'undefined') {
    const fromEnv = process.env.NEXT_PUBLIC_BUSCAPROP_WHATSAPP;
    if (fromEnv) return normalizePhone(fromEnv);
  }
  return FALLBACK_NUMBER;
}

/**
 * Normaliza un número de teléfono a formato E.164 sin '+' (lo que wa.me espera).
 *   "+57 300 123 4567" → "573001234567"
 *   "300 123 4567"     → "573001234567"  (asume Colombia)
 */
function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  // Si ya empieza con 57 (Colombia), mantener. Si no, prefijo 57.
  if (digits.startsWith('57')) return digits;
  return `57${digits}`;
}

export interface WhatsAppLinkOptions {
  /** Mensaje custom; si no se pasa se construye automático desde el listing. */
  message?: string;
  /** Override del número (cuando tengamos contact_phone por property). */
  phone?: string | null;
}

export function buildWhatsAppLink(property: Property, opts: WhatsAppLinkOptions = {}): string {
  const number = getWhatsAppNumber(opts.phone);
  const text = opts.message ?? defaultMessage(property);
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

function defaultMessage(p: Property): string {
  const price = formatCOP(p.price_cop);
  const where = [p.neighborhood, p.city].filter(Boolean).join(', ');
  const portal = portalLabel(p.source_portal);
  return [
    `Hola, vi este inmueble en BuscaProp y me interesa:`,
    ``,
    `🏠 ${p.title}`,
    `📍 ${where}`,
    `💰 ${price}`,
    `🔗 Originalmente en ${portal}: ${p.source_url}`,
    ``,
    `¿Está disponible?`,
  ].join('\n');
}
