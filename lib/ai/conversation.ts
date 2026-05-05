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

export interface Conversation {
  id: string;
  channel: Channel;
  session_id: string | null;
  user_phone: string | null;
  property_id: string | null;
  lead_score: number;
  status: ConversationStatus;
  agency_id: string | null;
  agent_id: string | null;
  last_message_at: string;
  created_at: string;
  updated_at: string;
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
 * Encuentra una conversación existente para esta sesión web, o crea una nueva.
 * Idempotente — múltiples calls con mismo session_id devuelven la misma row.
 */
export async function getOrCreateWebConversation(
  sessionId: string,
  propertyId?: string
): Promise<Conversation> {
  const sb = getServerClient();

  // Lookup por session_id activo.
  const { data: existing } = await sb
    .from('conversations')
    .select('*')
    .eq('channel', 'web')
    .eq('session_id', sessionId)
    .neq('status', 'closed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) return existing as Conversation;

  // Crear nueva.
  const { data: created, error } = await sb
    .from('conversations')
    .insert({
      channel: 'web',
      session_id: sessionId,
      property_id: propertyId ?? null,
    })
    .select('*')
    .single();

  if (error || !created) {
    throw new Error(`No se pudo crear conversation: ${error?.message ?? 'unknown'}`);
  }
  return created as Conversation;
}

export async function getConversation(id: string): Promise<Conversation | null> {
  const sb = getServerClient();
  const { data } = await sb.from('conversations').select('*').eq('id', id).maybeSingle();
  return (data as Conversation | null) ?? null;
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

  const { data, error } = await sb
    .from('leads')
    .insert({
      conversation_id: args.conversationId,
      property_id: args.propertyId ?? null,
      agency_id: args.agencyId ?? null,
      lead_score: args.leadScore,
      summary: args.summary ?? null,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`promoteToLead failed: ${error?.message}`);

  // Sincronizar status en conversations.
  await sb
    .from('conversations')
    .update({ status: 'qualified' })
    .eq('id', args.conversationId);

  return { id: data.id as string, alreadyExisted: false };
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
