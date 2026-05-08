// app/api/admin/conversations/[id]/route.ts
// Admin-only endpoint que devuelve toda la data necesaria para renderizar
// un conversation viewer:
//   - Datos de la conversación (status, score, preferencias, UTM)
//   - Identidad del cliente (auth.users → name, email)
//   - Timeline completo de mensajes con tool_calls
//   - Diccionario de propiedades referenciadas (id → full data)
//
// Auth: 2 capas igual que /api/analytics:
//   1. JWT válido de Supabase (Bearer)
//   2. Email del user ∈ ADMIN_EMAILS

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type AuthResult =
  | { ok: true; email: string }
  | { ok: false; status: 401 | 403 | 500; error: string };

async function authorize(req: NextRequest): Promise<AuthResult> {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return { ok: false, status: 401, error: 'Unauthorized' };
  const token = auth.slice('Bearer '.length).trim();
  if (!token) return { ok: false, status: 401, error: 'Unauthorized' };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return { ok: false, status: 500, error: 'Server misconfigured' };
  const client = createClient(url, anon);
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user?.email) return { ok: false, status: 401, error: 'Unauthorized' };

  const adminList = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (adminList.length === 0) return { ok: false, status: 500, error: 'ADMIN_EMAILS not configured' };
  const email = data.user.email.toLowerCase();
  if (!adminList.includes(email)) return { ok: false, status: 403, error: 'Forbidden — admin only' };

  return { ok: true, email };
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await authorize(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const { id: conversationId } = await context.params;
  if (!conversationId || typeof conversationId !== 'string') {
    return NextResponse.json({ ok: false, error: 'Invalid id' }, { status: 400 });
  }

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  // 1. Conversación + 2. Mensajes en paralelo.
  const [convRes, msgsRes] = await Promise.all([
    sb.from('conversations').select('*').eq('id', conversationId).maybeSingle(),
    sb
      .from('conversation_messages')
      .select('id, role, content, tool_calls, tool_result, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true }),
  ]);

  if (!convRes.data) {
    return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
  }

  const conv = convRes.data as Record<string, unknown>;
  const messages = (msgsRes.data ?? []) as Array<{
    id: string;
    role: string;
    content: string;
    tool_calls: unknown;
    tool_result: unknown;
    created_at: string;
  }>;

  // 3. Identidad: auth.users por user_id.
  let user: { full_name: string | null; email: string | null } | null = null;
  const userId = (conv.user_id as string | null) ?? null;
  if (userId) {
    const { data: userResp } = await sb.auth.admin.getUserById(userId);
    const u = userResp?.user;
    if (u) {
      const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
      user = {
        full_name:
          (meta.full_name as string | undefined) ??
          (meta.fullName as string | undefined) ??
          (meta.name as string | undefined) ??
          null,
        email: u.email ?? null,
      };
    }
  }

  // 4. Properties referenciadas en tool_calls (fetchPropertyById, scheduleVisit)
  //    + property_id directo de la conversación.
  const propIds = new Set<string>();
  if (conv.property_id) propIds.add(conv.property_id as string);
  for (const m of messages) {
    const tc = Array.isArray(m.tool_calls) ? m.tool_calls : [];
    for (const t of tc) {
      const tt = t as { name?: string; input?: Record<string, unknown> };
      if (tt?.name === 'fetchPropertyById' && typeof tt.input?.id === 'string') {
        propIds.add(tt.input.id);
      }
      if (tt?.name === 'scheduleVisit' && typeof tt.input?.property_id === 'string') {
        propIds.add(tt.input.property_id);
      }
    }
  }
  const properties: Record<string, unknown> = {};
  if (propIds.size > 0) {
    const { data: propsData } = await sb
      .from('properties')
      .select('id, title, neighborhood, city, listing_type, property_type, price_cop, bedrooms, bathrooms, area_m2, source_url, photos')
      .in('id', Array.from(propIds));
    for (const p of (propsData ?? []) as Array<{ id: string }>) {
      properties[p.id] = p;
    }
  }

  return NextResponse.json({
    ok: true,
    conversation: {
      id: conv.id,
      channel: conv.channel,
      status: conv.status,
      lead_score: conv.lead_score,
      user_id: conv.user_id,
      user_phone: conv.user_phone,
      property_id: conv.property_id,
      preferences: conv.preferences ?? {},
      utm_source: conv.utm_source ?? null,
      utm_medium: conv.utm_medium ?? null,
      utm_campaign: conv.utm_campaign ?? null,
      utm_term: conv.utm_term ?? null,
      utm_content: conv.utm_content ?? null,
      referrer: conv.referrer ?? null,
      landing_path: conv.landing_path ?? null,
      created_at: conv.created_at,
      updated_at: conv.updated_at,
      last_message_at: conv.last_message_at,
    },
    user,
    messages,
    properties,
  });
}
