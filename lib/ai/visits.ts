// lib/ai/visits.ts
// Persistencia + notificación de solicitudes de visita (tool scheduleVisit).
// Service-role only — server-side. Reemplaza el viejo stub in-memory.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/notify/email';

let cachedClient: SupabaseClient | null = null;
function getClient(): SupabaseClient {
  if (cachedClient) return cachedClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Faltan SUPABASE_URL / SERVICE_ROLE_KEY');
  cachedClient = createClient(url, key, { auth: { persistSession: false } });
  return cachedClient;
}

const APP_BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://buscaprop.co';

export interface CreateVisitRequestArgs {
  conversationId: string;
  propertyId: string;
  preferredWhen?: string;
  contactMethod?: string;
}

export interface VisitRequestRecord {
  id: string;
  conversation_id: string;
  property_id: string | null;
  preferred_when: string | null;
  contact_method: string;
  status: string;
  created_at: string;
}

/**
 * Persiste una solicitud de visita y dispara (best-effort) un email al asesor.
 * La notificación NO bloquea: si Resend falla, la fila ya quedó guardada y el
 * asesor puede verla en la tabla / futuro dashboard.
 */
export async function createVisitRequest(
  args: CreateVisitRequestArgs
): Promise<VisitRequestRecord> {
  const sb = getClient();
  const { data, error } = await sb
    .from('visit_requests')
    .insert({
      conversation_id: args.conversationId,
      property_id: args.propertyId,
      preferred_when: args.preferredWhen ?? null,
      contact_method: args.contactMethod ?? 'whatsapp',
    })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`No se pudo registrar la visita: ${error?.message ?? 'sin datos'}`);
  }

  // Notificación best-effort al asesor — no await crítico para el tool.
  await notifyAdvisor(sb, data as VisitRequestRecord).catch((err) =>
    console.error('[visits] notifyAdvisor failed', err)
  );

  return data as VisitRequestRecord;
}

async function notifyAdvisor(sb: SupabaseClient, visit: VisitRequestRecord): Promise<void> {
  const to = process.env.LEADS_NOTIFY_TO;
  if (!to) {
    console.error('[visits] missing LEADS_NOTIFY_TO — visit persisted but no email sent');
    return;
  }

  let property: {
    title: string | null;
    city: string | null;
    neighborhood: string | null;
    price_cop: number | null;
    source_url: string | null;
  } | null = null;
  if (visit.property_id) {
    const { data } = await sb
      .from('properties')
      .select('title, city, neighborhood, price_cop, source_url')
      .eq('id', visit.property_id)
      .single();
    property = data ?? null;
  }

  const price =
    property?.price_cop != null
      ? `$${property.price_cop.toLocaleString('es-CO')}`
      : 's/precio';
  const loc = [property?.neighborhood, property?.city].filter(Boolean).join(', ') || '—';
  const propLine = property
    ? `${property.title ?? 'Propiedad'} · ${price} · ${loc}`
    : `Propiedad ${visit.property_id ?? '—'}`;
  const portalLink = property?.source_url ? `\nPortal: ${property.source_url}` : '';
  const convLink = `${APP_BASE_URL}/admin/conversations/${visit.conversation_id}`;

  const subject = `📅 Solicitud de visita · ${loc}`;
  const text =
    `Nueva solicitud de visita desde el chat.\n\n` +
    `${propLine}${portalLink}\n` +
    `Cuándo prefiere: ${visit.preferred_when ?? 'no especificado'}\n` +
    `Método de contacto: ${visit.contact_method}\n\n` +
    `Conversación: ${convLink}\n` +
    `visit_request id: ${visit.id}`;
  const html =
    `<h2>📅 Solicitud de visita</h2>` +
    `<p><strong>${escapeHtml(propLine)}</strong>${
      property?.source_url
        ? ` · <a href="${escapeHtml(property.source_url)}">ver en portal</a>`
        : ''
    }</p>` +
    `<ul>` +
    `<li><strong>Cuándo prefiere:</strong> ${escapeHtml(visit.preferred_when ?? 'no especificado')}</li>` +
    `<li><strong>Método de contacto:</strong> ${escapeHtml(visit.contact_method)}</li>` +
    `</ul>` +
    `<p><a href="${escapeHtml(convLink)}">Abrir conversación</a></p>` +
    `<p style="color:#888;font-size:12px">visit_request id: ${escapeHtml(visit.id)}</p>`;

  await sendEmail({ to, subject, html, text });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
