// app/api/leads/notify/route.ts
// Webhook receptor: Supabase dispara INSERT en `leads` → este endpoint envía
// un email al equipo con el contexto del lead (teléfono, preferencias, score,
// propiedad de interés, link a la conversación). El usuario final NO ve nada.
//
// Auth: header Authorization: Bearer ${SUPABASE_WEBHOOK_SECRET}. El secret se
// configura en el Database Webhook de Supabase. Comparación timing-safe.
//
// Resend: enviamos vía REST API (sin SDK adicional) al dominio verificado
// buscaprop.co. FROM hardcodeado (atado al dominio); TO viene de LEADS_NOTIFY_TO.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'node:crypto';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const FROM = 'BuscaProp <leads@buscaprop.co>';
const RESEND_URL = 'https://api.resend.com/emails';

interface SupabaseWebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
  schema: string;
  record: Record<string, unknown> | null;
  old_record: Record<string, unknown> | null;
}

function checkAuth(req: NextRequest): boolean {
  const expected = process.env.SUPABASE_WEBHOOK_SECRET;
  if (!expected) return false;
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return false;
  const provided = auth.slice('Bearer '.length).trim();
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  let payload: SupabaseWebhookPayload;
  try {
    payload = (await req.json()) as SupabaseWebhookPayload;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  // Solo INSERT en `leads`. Otros eventos: 200 OK para no provocar reintentos.
  if (payload.type !== 'INSERT' || payload.table !== 'leads' || !payload.record) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'not a leads INSERT' });
  }

  const lead = payload.record;
  const conversationId = (lead.conversation_id as string) ?? null;
  const propertyId = (lead.property_id as string) ?? null;
  const leadScore = (lead.lead_score as number) ?? null;
  const summary = (lead.summary as string | null) ?? null;
  const leadId = (lead.id as string) ?? '—';

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  // Enriquecimiento en paralelo: conversación + propiedad (si hay).
  const [convRes, propRes] = await Promise.all([
    conversationId
      ? sb
          .from('conversations')
          .select('id, channel, user_phone, preferences, status, created_at')
          .eq('id', conversationId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    propertyId
      ? sb
          .from('properties')
          .select('id, title, neighborhood, city, listing_type, price_cop, source_url')
          .eq('id', propertyId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const conv = (convRes as { data: Record<string, unknown> | null }).data;
  const prop = (propRes as { data: Record<string, unknown> | null }).data;

  const phone = (conv?.user_phone as string | null) ?? null;
  const channel = (conv?.channel as string) ?? '—';
  const preferences = (conv?.preferences as Record<string, unknown> | null) ?? {};

  const subject = `🔔 Lead BuscaProp · score ${leadScore ?? '—'} · ${phone ? '+57 ' + phone : 'sin tel'}`;
  const { html, text } = buildEmailBodies({
    leadId,
    conversationId,
    leadScore,
    summary,
    phone,
    channel,
    preferences,
    property: prop,
  });

  const to = process.env.LEADS_NOTIFY_TO;
  const apiKey = process.env.RESEND_API_KEY;
  if (!to || !apiKey) {
    console.error('[leads/notify] missing LEADS_NOTIFY_TO or RESEND_API_KEY');
    return NextResponse.json(
      { ok: false, error: 'Missing LEADS_NOTIFY_TO or RESEND_API_KEY' },
      { status: 500 }
    );
  }

  const sent = await fetch(RESEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM, to: [to], subject, html, text }),
  });

  if (!sent.ok) {
    const errBody = await sent.text();
    console.error('[leads/notify] Resend error', sent.status, errBody);
    return NextResponse.json(
      { ok: false, error: 'Resend failed', status: sent.status },
      { status: 502 }
    );
  }

  const body = (await sent.json()) as { id?: string };
  return NextResponse.json({ ok: true, resend_id: body.id, lead_id: leadId });
}

interface EmailContext {
  leadId: string;
  conversationId: string | null;
  leadScore: number | null;
  summary: string | null;
  phone: string | null;
  channel: string;
  preferences: Record<string, unknown>;
  property: Record<string, unknown> | null;
}

function fmtCop(n: unknown): string {
  return typeof n === 'number'
    ? new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: 'COP',
        maximumFractionDigits: 0,
      }).format(n)
    : '—';
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildEmailBodies(ctx: EmailContext): { html: string; text: string } {
  const phoneLink = ctx.phone
    ? `<a href="https://wa.me/57${ctx.phone}">+57 ${ctx.phone}</a>`
    : '—';

  const prefRows: Array<[string, string]> = [];
  const p = ctx.preferences;
  if (p.city) prefRows.push(['Ciudad', String(p.city)]);
  if (p.neighborhood) prefRows.push(['Barrio', String(p.neighborhood)]);
  if (p.property_type) prefRows.push(['Tipo', String(p.property_type)]);
  if (p.listing_type) prefRows.push(['Operación', String(p.listing_type)]);
  if (p.min_bedrooms) prefRows.push(['Cuartos mín.', String(p.min_bedrooms)]);
  if (p.min_bathrooms) prefRows.push(['Baños mín.', String(p.min_bathrooms)]);
  if (p.min_price || p.max_price) {
    prefRows.push(['Rango precio', `${fmtCop(p.min_price)} – ${fmtCop(p.max_price)}`]);
  }
  if (p.parking_required !== undefined && p.parking_required !== null) {
    prefRows.push(['Parqueadero', p.parking_required ? 'sí' : 'no']);
  }
  if (p.urgency) prefRows.push(['Urgencia', String(p.urgency)]);
  if (p.financing_needed !== undefined && p.financing_needed !== null) {
    prefRows.push(['Financiación', p.financing_needed ? 'sí' : 'no']);
  }
  if (p.notes) prefRows.push(['Notas', String(p.notes)]);

  const prefHtml = prefRows.length
    ? `<table style="border-collapse:collapse;font-size:14px">${prefRows
        .map(
          ([k, v]) =>
            `<tr><td style="padding:4px 14px 4px 0;color:#666;vertical-align:top">${escapeHtml(k)}</td><td style="padding:4px 0">${escapeHtml(v)}</td></tr>`
        )
        .join('')}</table>`
    : '<em style="color:#999">sin preferencias capturadas</em>';

  const prop = ctx.property;
  const propHtml = prop
    ? `<h3 style="margin:24px 0 8px">Propiedad de interés</h3>
       <p style="margin:0 0 4px"><strong>${escapeHtml(String(prop.title ?? '—'))}</strong></p>
       <p style="margin:0 0 4px;color:#666">${escapeHtml(String(prop.neighborhood ?? '—'))}, ${escapeHtml(String(prop.city ?? '—'))} · ${escapeHtml(String(prop.listing_type ?? '—'))} · ${fmtCop(prop.price_cop)}</p>
       ${prop.source_url ? `<p style="margin:0"><a href="${escapeHtml(String(prop.source_url))}">Ver en portal →</a></p>` : ''}`
    : '';

  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;color:#222;line-height:1.5">
  <h2 style="margin:0 0 4px">🔔 Nuevo lead BuscaProp</h2>
  <p style="margin:0 0 20px;color:#666;font-size:14px">Score <strong>${ctx.leadScore ?? '—'}</strong> · canal ${escapeHtml(ctx.channel)}</p>
  <p style="margin:0 0 8px"><strong>Contacto:</strong> ${phoneLink}</p>
  ${ctx.summary ? `<p style="margin:0 0 16px"><strong>Resumen:</strong> ${escapeHtml(ctx.summary)}</p>` : ''}
  <h3 style="margin:24px 0 8px">Preferencias</h3>
  ${prefHtml}
  ${propHtml}
  <hr style="border:none;border-top:1px solid #eee;margin:28px 0 12px">
  <p style="font-size:12px;color:#999;margin:0">
    Lead ID: <code>${escapeHtml(ctx.leadId)}</code><br>
    Conversation ID: <code>${escapeHtml(ctx.conversationId ?? '—')}</code>
  </p>
</div>`;

  const textLines: Array<string | null> = [
    'Nuevo lead BuscaProp',
    `Score: ${ctx.leadScore ?? '—'} · Canal: ${ctx.channel}`,
    `Teléfono: ${ctx.phone ? '+57 ' + ctx.phone : '—'}`,
    ctx.summary ? `Resumen: ${ctx.summary}` : null,
    '',
    'Preferencias:',
    ...prefRows.map(([k, v]) => `  ${k}: ${v}`),
    prop
      ? `\nPropiedad: ${prop.title ?? '—'} (${prop.neighborhood ?? '—'}, ${prop.city ?? '—'}) · ${fmtCop(prop.price_cop)}`
      : null,
    prop?.source_url ? `URL: ${prop.source_url}` : null,
    '',
    `Lead ID: ${ctx.leadId}`,
    `Conversation ID: ${ctx.conversationId ?? '—'}`,
  ];
  const text = textLines.filter((l): l is string => l !== null).join('\n');

  return { html, text };
}
