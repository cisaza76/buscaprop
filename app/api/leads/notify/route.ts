// app/api/leads/notify/route.ts
// Webhook receptor: Supabase dispara INSERT en `leads` → este endpoint envía
// un email-briefing al equipo con TODO lo necesario para que un asesor humano
// atienda al cliente sin abrir 5 sistemas distintos.
//
// Estructura del briefing:
//   Header  : nombre + email (auth.users) + teléfono + score + canal
//   Resumen : primer mensaje del cliente (su intent original)
//   🔥 Visitas: scheduleVisit calls + property full data + cuándo + método
//   👀 Propiedades: fetchPropertyById calls + property full data + link portal
//   🎯 Preferencias: conversation.preferences finales
//   📋 Búsquedas: filtros usados en cada searchProperties (NO las props devueltas)
//
// Auth: Bearer SUPABASE_WEBHOOK_SECRET. timing-safe compare. INSERT en `leads`
// es el único evento procesado; otros → 200 skipped (sin reintentos).

import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'node:crypto';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const FROM = 'BuscaProp <leads@buscaprop.co>';
const RESEND_URL = 'https://api.resend.com/emails';
const APP_BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://buscaprop.co';
const MAX_VISITS = 5;
const MAX_OPENED = 8;
const MAX_SEARCHES = 6;

interface SupabaseWebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
  schema: string;
  record: Record<string, unknown> | null;
  old_record: Record<string, unknown> | null;
}

interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface PropertyRow {
  id: string;
  title: string | null;
  neighborhood: string | null;
  city: string | null;
  listing_type: string | null;
  property_type: string | null;
  price_cop: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  area_m2: number | null;
  source_url: string | null;
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

  if (payload.type !== 'INSERT' || payload.table !== 'leads' || !payload.record) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'not a leads INSERT' });
  }

  const lead = payload.record;
  const conversationId = (lead.conversation_id as string) ?? null;
  const propertyId = (lead.property_id as string) ?? null;
  const leadScore = (lead.lead_score as number) ?? null;
  const leadId = (lead.id as string) ?? '—';

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const briefing = await buildBriefing(sb, {
    conversationId,
    fallbackPropertyId: propertyId,
  });

  const subject = `🔔 Lead BuscaProp · ${briefing.displayName} · score ${leadScore ?? '—'}`;
  const { html, text } = renderEmail({
    leadId,
    conversationId,
    leadScore,
    ...briefing,
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

// ============================================================================
// Briefing builder — agrega todo lo que el asesor necesita en una pasada.
// ============================================================================

interface VisitEntry {
  property: PropertyRow | null;
  preferred_when: string | null;
  contact_method: string | null;
}

interface SearchEntry {
  city: string | null;
  neighborhood: string | null;
  property_type: string | null;
  listing_type: string | null;
  min_bedrooms: number | null;
  min_price: number | null;
  max_price: number | null;
}

interface Briefing {
  displayName: string;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  channel: string;
  preferences: Record<string, unknown>;
  firstUserMessage: string | null;
  visits: VisitEntry[];
  openedProperties: PropertyRow[];
  searches: SearchEntry[];
}

async function buildBriefing(
  sb: SupabaseClient,
  args: { conversationId: string | null; fallbackPropertyId: string | null }
): Promise<Briefing> {
  const empty: Briefing = {
    displayName: 'Lead anónimo',
    fullName: null,
    email: null,
    phone: null,
    channel: '—',
    preferences: {},
    firstUserMessage: null,
    visits: [],
    openedProperties: [],
    searches: [],
  };
  if (!args.conversationId) return empty;

  const [convRes, msgsRes] = await Promise.all([
    sb
      .from('conversations')
      .select('id, channel, user_id, user_phone, preferences')
      .eq('id', args.conversationId)
      .maybeSingle(),
    sb
      .from('conversation_messages')
      .select('role, content, tool_calls, created_at')
      .eq('conversation_id', args.conversationId)
      .order('created_at', { ascending: true }),
  ]);

  const conv = (convRes.data ?? null) as Record<string, unknown> | null;
  const messages = (msgsRes.data ?? []) as Array<{
    role: string;
    content: string;
    tool_calls: ToolUseBlock[] | null;
  }>;

  // Identidad: viene de auth.users si la conversación tiene user_id.
  const userId = (conv?.user_id as string | null) ?? null;
  let fullName: string | null = null;
  let email: string | null = null;
  if (userId) {
    const { data: userResp } = await sb.auth.admin.getUserById(userId);
    const u = userResp?.user;
    email = u?.email ?? null;
    const meta = (u?.user_metadata ?? {}) as Record<string, unknown>;
    fullName =
      (meta.full_name as string | undefined) ??
      (meta.fullName as string | undefined) ??
      (meta.name as string | undefined) ??
      null;
  }
  const displayName = fullName || email || 'Lead anónimo';

  // Extraer tool_calls agrupados por nombre.
  const allToolUses: ToolUseBlock[] = messages
    .flatMap((m) => m.tool_calls ?? [])
    .filter((b): b is ToolUseBlock => !!b && b.type === 'tool_use');

  const scheduleVisitCalls = allToolUses.filter((t) => t.name === 'scheduleVisit');
  const fetchPropertyCalls = allToolUses.filter((t) => t.name === 'fetchPropertyById');
  const searchCalls = allToolUses.filter((t) => t.name === 'searchProperties');

  // Recolectar property_ids de visitas + properties abiertas + fallback de la lead row.
  const idSet = new Set<string>();
  for (const t of scheduleVisitCalls) {
    const id = t.input?.property_id;
    if (typeof id === 'string') idSet.add(id);
  }
  for (const t of fetchPropertyCalls) {
    const id = t.input?.id;
    if (typeof id === 'string') idSet.add(id);
  }
  if (args.fallbackPropertyId) idSet.add(args.fallbackPropertyId);

  const propertyById = new Map<string, PropertyRow>();
  if (idSet.size > 0) {
    const { data } = await sb
      .from('properties')
      .select(
        'id, title, neighborhood, city, listing_type, property_type, price_cop, bedrooms, bathrooms, area_m2, source_url'
      )
      .in('id', Array.from(idSet));
    for (const row of (data ?? []) as PropertyRow[]) {
      propertyById.set(row.id, row);
    }
  }

  // Construir visit entries.
  const visits: VisitEntry[] = scheduleVisitCalls.slice(-MAX_VISITS).map((t) => ({
    property: typeof t.input.property_id === 'string'
      ? propertyById.get(t.input.property_id) ?? null
      : null,
    preferred_when: typeof t.input.preferred_when === 'string' ? t.input.preferred_when : null,
    contact_method: typeof t.input.contact_method === 'string' ? t.input.contact_method : null,
  }));

  // Propiedades abiertas — únicas, en orden de primera vez.
  const openedSeen = new Set<string>();
  const openedProperties: PropertyRow[] = [];
  for (const t of fetchPropertyCalls) {
    const id = t.input?.id;
    if (typeof id !== 'string' || openedSeen.has(id)) continue;
    openedSeen.add(id);
    const prop = propertyById.get(id);
    if (prop) openedProperties.push(prop);
    if (openedProperties.length >= MAX_OPENED) break;
  }

  // Búsquedas — solo criterios.
  const searches: SearchEntry[] = searchCalls.slice(-MAX_SEARCHES).map((t) => ({
    city: typeof t.input.city === 'string' ? t.input.city : null,
    neighborhood: typeof t.input.neighborhood === 'string' ? t.input.neighborhood : null,
    property_type: typeof t.input.property_type === 'string' ? t.input.property_type : null,
    listing_type: typeof t.input.listing_type === 'string' ? t.input.listing_type : null,
    min_bedrooms: typeof t.input.min_bedrooms === 'number' ? t.input.min_bedrooms : null,
    min_price: typeof t.input.min_price === 'number' ? t.input.min_price : null,
    max_price: typeof t.input.max_price === 'number' ? t.input.max_price : null,
  }));

  // Primer mensaje del cliente.
  const firstUser = messages.find((m) => m.role === 'user' && m.content?.trim());
  const firstUserMessage = firstUser?.content?.trim()?.slice(0, 300) ?? null;

  return {
    displayName,
    fullName,
    email,
    phone: (conv?.user_phone as string | null) ?? null,
    channel: (conv?.channel as string) ?? '—',
    preferences: (conv?.preferences as Record<string, unknown>) ?? {},
    firstUserMessage,
    visits,
    openedProperties,
    searches,
  };
}

// ============================================================================
// Render
// ============================================================================

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

function propLine(p: PropertyRow): string {
  const parts = [p.neighborhood, p.city].filter(Boolean).join(', ') || '—';
  const meta = [
    p.listing_type,
    p.bedrooms ? `${p.bedrooms} cuartos` : null,
    p.area_m2 ? `${p.area_m2} m²` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return `${parts} · ${meta} · ${fmtCop(p.price_cop)}`;
}

interface EmailContext extends Briefing {
  leadId: string;
  conversationId: string | null;
  leadScore: number | null;
}

function renderEmail(ctx: EmailContext): { html: string; text: string } {
  const phoneLink = ctx.phone
    ? `<a href="https://wa.me/57${ctx.phone}" style="color:#0a7d6c">+57 ${ctx.phone}</a>`
    : '—';
  const emailLink = ctx.email
    ? `<a href="mailto:${ctx.email}" style="color:#0a7d6c">${ctx.email}</a>`
    : '—';

  // CTA al viewer interno — la acción más valiosa para el asesor.
  const viewerUrl = ctx.conversationId
    ? `${APP_BASE_URL}/dashboard/conversations/${ctx.conversationId}`
    : null;
  const viewerCta = viewerUrl
    ? `<p style="margin:0 0 20px"><a href="${viewerUrl}" style="display:inline-block;padding:10px 18px;background:#0a7d6c;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px">Ver chat completo →</a></p>`
    : '';

  // Header
  const header = `
    <h2 style="margin:0 0 4px;font-size:20px">🔔 Nuevo lead BuscaProp</h2>
    <p style="margin:0 0 20px;color:#666;font-size:14px">
      Score <strong>${ctx.leadScore ?? '—'}</strong> · canal ${escapeHtml(ctx.channel)}
    </p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:16px">
      <tr><td style="padding:4px 12px 4px 0;color:#666;width:90px">Nombre</td><td>${escapeHtml(ctx.fullName ?? '—')}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666">Email</td><td>${emailLink}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666">Teléfono</td><td>${phoneLink}</td></tr>
    </table>
    ${viewerCta}`;

  // Resumen interés
  const interestHtml = ctx.firstUserMessage
    ? `<h3 style="margin:0 0 8px;font-size:15px">📝 Mensaje inicial del cliente</h3>
       <p style="margin:0 0 24px;padding:12px;background:#f8f8f8;border-left:3px solid #0a7d6c;font-size:14px;color:#333">${escapeHtml(ctx.firstUserMessage)}</p>`
    : '';

  // Visitas pedidas (1ra prioridad)
  const visitsHtml = ctx.visits.length
    ? `<h3 style="margin:0 0 8px;font-size:15px;color:#c2410c">🔥 Visitas pedidas (${ctx.visits.length})</h3>
       <div style="margin:0 0 24px">${ctx.visits
         .map((v) => {
           const propBlock = v.property
             ? `<p style="margin:0 0 4px"><strong>${escapeHtml(v.property.title ?? '—')}</strong></p>
                <p style="margin:0 0 4px;color:#666;font-size:13px">${escapeHtml(propLine(v.property))}</p>
                ${v.property.source_url ? `<p style="margin:0 0 4px;font-size:13px"><a href="${escapeHtml(v.property.source_url)}" style="color:#0a7d6c">Ver en portal →</a></p>` : ''}`
             : '<p style="margin:0 0 4px;color:#999"><em>(propiedad no encontrada)</em></p>';
           const meta = [
             v.preferred_when ? `Cuándo: <strong>${escapeHtml(v.preferred_when)}</strong>` : null,
             v.contact_method ? `Método: ${escapeHtml(v.contact_method)}` : null,
           ]
             .filter(Boolean)
             .join(' · ');
           return `<div style="border:1px solid #fed7aa;background:#fff7ed;border-radius:8px;padding:12px;margin-bottom:8px">
             ${propBlock}
             ${meta ? `<p style="margin:8px 0 0;font-size:13px;color:#7c2d12">${meta}</p>` : ''}
           </div>`;
         })
         .join('')}</div>`
    : '';

  // Propiedades abiertas (2da prioridad)
  const openedHtml = ctx.openedProperties.length
    ? `<h3 style="margin:0 0 8px;font-size:15px">👀 Propiedades que abrió (${ctx.openedProperties.length})</h3>
       <div style="margin:0 0 24px">${ctx.openedProperties
         .map(
           (p) => `<div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin-bottom:8px">
              <p style="margin:0 0 4px"><strong>${escapeHtml(p.title ?? '—')}</strong></p>
              <p style="margin:0;color:#666;font-size:13px">${escapeHtml(propLine(p))}</p>
              ${p.source_url ? `<p style="margin:6px 0 0;font-size:13px"><a href="${escapeHtml(p.source_url)}" style="color:#0a7d6c">Ver en portal →</a></p>` : ''}
            </div>`
         )
         .join('')}</div>`
    : '';

  // Preferencias finales
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
  if (p.parking_required != null) prefRows.push(['Parqueadero', p.parking_required ? 'sí' : 'no']);
  if (p.urgency) prefRows.push(['Urgencia', String(p.urgency)]);
  if (p.financing_needed != null) prefRows.push(['Financiación', p.financing_needed ? 'sí' : 'no']);
  if (p.notes) prefRows.push(['Notas', String(p.notes)]);

  const prefsHtml = prefRows.length
    ? `<h3 style="margin:0 0 8px;font-size:15px">🎯 Preferencias finales</h3>
       <table style="border-collapse:collapse;font-size:14px;margin:0 0 24px">${prefRows
         .map(
           ([k, v]) =>
             `<tr><td style="padding:4px 14px 4px 0;color:#666;vertical-align:top">${escapeHtml(k)}</td><td style="padding:4px 0">${escapeHtml(v)}</td></tr>`
         )
         .join('')}</table>`
    : '';

  // Búsquedas — solo criterios
  function searchToLine(s: SearchEntry): string {
    const bits = [
      s.city,
      s.neighborhood,
      s.property_type,
      s.listing_type,
      s.min_bedrooms ? `${s.min_bedrooms}+ cuartos` : null,
      s.min_price || s.max_price
        ? `${fmtCop(s.min_price)} – ${fmtCop(s.max_price)}`
        : null,
    ].filter(Boolean) as string[];
    return bits.join(' · ') || '(sin filtros)';
  }
  const searchHtml = ctx.searches.length
    ? `<h3 style="margin:0 0 8px;font-size:15px">📋 Búsquedas hechas (${ctx.searches.length})</h3>
       <ol style="margin:0 0 24px;padding-left:20px;font-size:13px;color:#444">
         ${ctx.searches.map((s) => `<li style="margin:2px 0">${escapeHtml(searchToLine(s))}</li>`).join('')}
       </ol>`
    : '';

  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:640px;color:#222;line-height:1.5">
  ${header}
  ${interestHtml}
  ${visitsHtml}
  ${openedHtml}
  ${prefsHtml}
  ${searchHtml}
  <hr style="border:none;border-top:1px solid #eee;margin:28px 0 12px">
  <p style="font-size:11px;color:#999;margin:0">
    Lead ID: <code>${escapeHtml(ctx.leadId)}</code><br>
    Conversation ID: <code>${escapeHtml(ctx.conversationId ?? '—')}</code>
  </p>
</div>`;

  // Plain text version
  const lines: string[] = [
    'Nuevo lead BuscaProp',
    `Score: ${ctx.leadScore ?? '—'} · Canal: ${ctx.channel}`,
    '',
    `Nombre:    ${ctx.fullName ?? '—'}`,
    `Email:     ${ctx.email ?? '—'}`,
    `Teléfono:  ${ctx.phone ? '+57 ' + ctx.phone : '—'}`,
    '',
  ];
  if (viewerUrl) {
    lines.push(`Ver chat completo: ${viewerUrl}`, '');
  }
  if (ctx.firstUserMessage) {
    lines.push('📝 Mensaje inicial:', ctx.firstUserMessage, '');
  }
  if (ctx.visits.length) {
    lines.push(`🔥 Visitas pedidas (${ctx.visits.length}):`);
    ctx.visits.forEach((v, i) => {
      lines.push(
        `  ${i + 1}. ${v.property?.title ?? '(propiedad desconocida)'}${
          v.property ? ` — ${propLine(v.property)}` : ''
        }`
      );
      if (v.preferred_when) lines.push(`     cuándo: ${v.preferred_when}`);
      if (v.contact_method) lines.push(`     método: ${v.contact_method}`);
      if (v.property?.source_url) lines.push(`     ${v.property.source_url}`);
    });
    lines.push('');
  }
  if (ctx.openedProperties.length) {
    lines.push(`👀 Propiedades que abrió (${ctx.openedProperties.length}):`);
    ctx.openedProperties.forEach((p, i) => {
      lines.push(`  ${i + 1}. ${p.title ?? '—'} — ${propLine(p)}`);
      if (p.source_url) lines.push(`     ${p.source_url}`);
    });
    lines.push('');
  }
  if (prefRows.length) {
    lines.push('🎯 Preferencias finales:');
    prefRows.forEach(([k, v]) => lines.push(`  ${k}: ${v}`));
    lines.push('');
  }
  if (ctx.searches.length) {
    lines.push(`📋 Búsquedas hechas (${ctx.searches.length}):`);
    ctx.searches.forEach((s, i) => lines.push(`  ${i + 1}. ${searchToLine(s)}`));
    lines.push('');
  }
  lines.push(`Lead ID: ${ctx.leadId}`);
  lines.push(`Conversation ID: ${ctx.conversationId ?? '—'}`);

  return { html, text: lines.join('\n') };
}
