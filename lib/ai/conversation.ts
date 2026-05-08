// lib/ai/conversation.ts
// Persistencia de conversaciones en Supabase. Usa service_role (server-only).
// La API route /api/chat/test es la única consumidora directa.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type Anthropic from '@anthropic-ai/sdk';

let cachedClient: SupabaseClient | null = null;
function getServerClient(): SupabaseClient {
  if (cachedClient) return cachedClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Faltan SUPABASE_URL / SERVICE_ROLE_KEY');
  cachedClient = createClient(url, key, { auth: { persistSession: false } });
  return cachedClient;
}

export type Channel = 'web' | 'whatsapp';
export type ConversationStatus = 'active' | 'qualified' | 'escalated' | 'closed';
export type MessageRole = 'user' | 'assistant' | 'tool';

/**
 * Preferencias estructuradas del usuario que la AI va descubriendo turno a turno.
 * Es un patch — sólo guardamos lo que la AI confirmó. Cualquier campo puede ser
 * null/undefined si todavía no se sabe.
 */
export interface ConversationPreferences {
  city?: string;
  neighborhood?: string;
  property_type?: 'apartamento' | 'casa' | 'oficina' | 'lote';
  listing_type?: 'venta' | 'arriendo';
  min_bedrooms?: number;
  min_bathrooms?: number;
  min_price?: number;
  max_price?: number;
  parking_required?: boolean;
  urgency?: 'inmediato' | '1-3 meses' | '+3 meses';
  financing_needed?: boolean;
  /** Texto libre con cualquier requisito que no entre en los slots de arriba. */
  notes?: string;
}

export interface Conversation {
  id: string;
  channel: Channel;
  session_id: string | null;
  /** FK a auth.users(id). Null = conversación legacy/anónima previa al gate de auth. */
  user_id: string | null;
  user_phone: string | null;
  property_id: string | null;
  lead_score: number;
  status: ConversationStatus;
  agency_id: string | null;
  agent_id: string | null;
  last_message_at: string;
  created_at: string;
  updated_at: string;
  preferences: ConversationPreferences;
  // UTM tracking — capturado en el INSERT desde el cliente. NUNCA se sobreescribe
  // (preserva first-touch attribution). Null en conversaciones legacy.
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  referrer: string | null;
  landing_path: string | null;
}

export interface UtmInput {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  referrer?: string;
  landing_path?: string;
}

export interface ConversationMessage {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  tool_calls: Anthropic.ToolUseBlock[] | null;
  tool_result: { tool_use_id: string; result: string; is_error: boolean } | null;
  usage: Anthropic.Usage | null;
  created_at: string;
}

// ============================================================================
// Lookup / create
// ============================================================================

/**
 * Encuentra una conversación existente para este usuario/sesión web, o crea
 * una nueva. Idempotente:
 * - Si hay userId, lookup primario por user_id (account-bound — sobrevive
 *   cambios de browser/incógnito mientras el user esté logueado).
 * - Si no hay userId (anónimo, legacy), fallback a session_id + user_id IS NULL.
 *   Después del gate de auth, esto solo aplica a conversaciones viejas.
 */
export async function getOrCreateWebConversation(
  sessionId: string,
  opts: {
    userId?: string | null;
    propertyId?: string;
    utm?: UtmInput;
  } = {}
): Promise<Conversation> {
  const sb = getServerClient();
  const { userId = null, propertyId, utm = {} } = opts;

  let lookup = sb
    .from('conversations')
    .select('*')
    .eq('channel', 'web')
    .neq('status', 'closed')
    .order('created_at', { ascending: false })
    .limit(1);
  lookup = userId
    ? lookup.eq('user_id', userId)
    : lookup.eq('session_id', sessionId).is('user_id', null);

  const { data: existing } = await lookup.maybeSingle();

  if (existing) return normalizeConversation(existing as Record<string, unknown>);

  // Crear nueva. UTM solo se persiste en el INSERT (first-touch attribution).
  const { data: created, error } = await sb
    .from('conversations')
    .insert({
      channel: 'web',
      session_id: sessionId,
      user_id: userId,
      property_id: propertyId ?? null,
      utm_source: utm.utm_source ?? null,
      utm_medium: utm.utm_medium ?? null,
      utm_campaign: utm.utm_campaign ?? null,
      utm_term: utm.utm_term ?? null,
      utm_content: utm.utm_content ?? null,
      referrer: utm.referrer ?? null,
      landing_path: utm.landing_path ?? null,
    })
    .select('*')
    .single();

  if (error || !created) {
    throw new Error(`No se pudo crear conversation: ${error?.message ?? 'unknown'}`);
  }
  return normalizeConversation(created as Record<string, unknown>);
}

export async function getConversation(id: string): Promise<Conversation | null> {
  const sb = getServerClient();
  const { data } = await sb.from('conversations').select('*').eq('id', id).maybeSingle();
  if (!data) return null;
  return normalizeConversation(data as Record<string, unknown>);
}

/**
 * Asegura que la row tenga un `preferences` válido, incluso si la columna
 * todavía no existe (migration 006 no aplicada → field ausente).
 */
function normalizeConversation(row: Record<string, unknown>): Conversation {
  return {
    ...(row as unknown as Conversation),
    preferences: (row.preferences as ConversationPreferences | null) ?? {},
  };
}

// ============================================================================
// Messages
// ============================================================================

export async function listMessages(conversationId: string): Promise<ConversationMessage[]> {
  const sb = getServerClient();
  const { data, error } = await sb
    .from('conversation_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ConversationMessage[];
}

export async function appendMessage(
  conversationId: string,
  msg: {
    role: MessageRole;
    content: string;
    tool_calls?: Anthropic.ToolUseBlock[];
    tool_result?: { tool_use_id: string; result: string; is_error: boolean };
    usage?: Anthropic.Usage;
  }
): Promise<ConversationMessage> {
  const sb = getServerClient();
  const { data, error } = await sb
    .from('conversation_messages')
    .insert({
      conversation_id: conversationId,
      role: msg.role,
      content: msg.content,
      tool_calls: msg.tool_calls ?? null,
      tool_result: msg.tool_result ?? null,
      usage: msg.usage ?? null,
    })
    .select('*')
    .single();
  if (error || !data) throw new Error(`appendMessage failed: ${error?.message}`);
  return data as ConversationMessage;
}

// ============================================================================
// Score / status updates
// ============================================================================

export async function updateLeadScore(
  conversationId: string,
  score: number,
  status?: ConversationStatus
): Promise<void> {
  const sb = getServerClient();
  const patch: Record<string, unknown> = { lead_score: score };
  if (status) patch.status = status;
  const { error } = await sb.from('conversations').update(patch).eq('id', conversationId);
  if (error) throw error;
}

/**
 * Promueve una conversación a lead. Idempotente — si ya existe un lead para
 * esta conversation, no crea otro.
 */
export async function promoteToLead(args: {
  conversationId: string;
  leadScore: number;
  propertyId?: string;
  agencyId?: string;
  summary?: string;
}): Promise<{ id: string; alreadyExisted: boolean }> {
  const sb = getServerClient();

  const { data: existing } = await sb
    .from('leads')
    .select('id')
    .eq('conversation_id', args.conversationId)
    .maybeSingle();

  if (existing) {
    // Actualizar score por si subió.
    await sb.from('leads').update({ lead_score: args.leadScore }).eq('id', existing.id);
    return { id: existing.id as string, alreadyExisted: true };
  }

  // Intentamos insertar con todas las columnas. Si alguna falta en el schema
  // (migration parcial), reintentamos con un payload mínimo + log.
  const fullPayload: Record<string, unknown> = {
    conversation_id: args.conversationId,
    property_id: args.propertyId ?? null,
    agency_id: args.agencyId ?? null,
    lead_score: args.leadScore,
    summary: args.summary ?? null,
  };

  let inserted = await sb.from('leads').insert(fullPayload).select('id').single();
  // PostgREST devuelve "Could not find the '<col>' column ... in the schema cache"
  // o "column ... does not exist" según el path. Capturamos ambos.
  const isSchemaMissingError = (msg: string | undefined) =>
    !!msg && (/column .* does not exist/i.test(msg) || /could not find.*column/i.test(msg));

  if (inserted.error && isSchemaMissingError(inserted.error.message)) {
    console.warn(
      `[promoteToLead] schema incompleto (${inserted.error.message}). ` +
        `Reintentando con payload mínimo. Aplicá la migration 007.`
    );
    const minimalPayload = {
      conversation_id: args.conversationId,
      property_id: args.propertyId ?? null,
      lead_score: args.leadScore,
    };
    inserted = await sb.from('leads').insert(minimalPayload).select('id').single();
  }
  if (inserted.error || !inserted.data) {
    throw new Error(`promoteToLead failed: ${inserted.error?.message}`);
  }

  // Sincronizar status en conversations (esta sí existe siempre).
  await sb
    .from('conversations')
    .update({ status: 'qualified' })
    .eq('id', args.conversationId);

  return { id: inserted.data.id as string, alreadyExisted: false };
}

// ============================================================================
// Preferences + contact updates (tools recordUserPreferences / requestContact)
// ============================================================================

/**
 * Hace MERGE shallow de preferences. Sólo sobreescribe las keys provistas en
 * `patch` — el resto se conserva. Si `patch` trae { city: undefined } NO borra
 * la key existente (filtramos undefined antes del merge).
 */
export async function updatePreferences(
  conversationId: string,
  patch: ConversationPreferences
): Promise<ConversationPreferences> {
  const sb = getServerClient();

  // Filtrar undefined (no queremos borrar keys que ya estaban set).
  const cleanPatch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) cleanPatch[k] = v;
  }
  if (Object.keys(cleanPatch).length === 0) {
    // Nada que actualizar — devolver lo actual.
    const conv = await getConversation(conversationId);
    return conv?.preferences ?? {};
  }

  // Read-modify-write. Concurrencia: si dos tools del mismo turno actualizan
  // simultáneamente, el último gana — aceptable para nuestro caso (un solo loop).
  const current = (await getConversation(conversationId))?.preferences ?? {};
  const merged = { ...current, ...cleanPatch };

  const { error } = await sb
    .from('conversations')
    .update({ preferences: merged })
    .eq('id', conversationId);
  if (error) throw new Error(`updatePreferences failed: ${error.message}`);
  return merged as ConversationPreferences;
}

/**
 * Setea user_phone en la conversación. Idempotente — si ya estaba set con el
 * mismo valor no hace nada. Normaliza a sólo dígitos (sin '+', '-', espacios).
 */
export async function setUserPhone(
  conversationId: string,
  phoneRaw: string
): Promise<string> {
  const sb = getServerClient();
  const phone = phoneRaw.replace(/\D/g, '');
  if (phone.length < 7) {
    throw new Error(`Teléfono inválido: ${phoneRaw}`);
  }
  const { error } = await sb
    .from('conversations')
    .update({ user_phone: phone })
    .eq('id', conversationId);
  if (error) throw new Error(`setUserPhone failed: ${error.message}`);
  return phone;
}

// ============================================================================
// Rate limit (simple in-memory, ok para MVP single-instance)
// ============================================================================

const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(
  key: string,
  limit = 100,
  windowMs = 60_000
): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1 };
  }
  bucket.count++;
  return { allowed: bucket.count <= limit, remaining: Math.max(0, limit - bucket.count) };
}
