// app/api/chat/test/route.ts
// Endpoint POST para el chatbot AI desde el web widget.
//
// Body:
//   { session_id: string (UUID), message: string, property_id?: string }
//
// Response:
//   {
//     conversation_id, ai_response, lead_score, status, tools_used,
//     promoted_to_lead, usage, truncated
//   }
//
// Auth: REQUERIDA — header Authorization: Bearer <Supabase JWT>. La JWT se
// valida server-side y el user.id queda ligado a la conversación (FK a
// auth.users). Sin auth → 401.

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateAIResponse } from '@/lib/whatsapp-ai';
import { getOrCreateWebConversation, checkRateLimit } from '@/lib/ai/conversation';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // segundos. Tool loop puede tomar 30-50s en peor caso.

const MAX_MESSAGE_LENGTH = 2000;

async function getAuthenticatedUserId(req: NextRequest): Promise<string | null> {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  const token = auth.slice('Bearer '.length).trim();
  if (!token) return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  const client = createClient(url, anon);
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user?.id) return null;
  return data.user.id;
}

export async function POST(request: NextRequest) {
  // Auth gate — sin user_id no hay chat.
  const userId = await getAuthenticatedUserId(request);
  if (!userId) {
    return jsonError('Unauthorized — login required', 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError('Body debe ser JSON válido', 400);
  }

  const { session_id, message, property_id, utm } = body as {
    session_id?: string;
    message?: string;
    property_id?: string;
    utm?: Record<string, string | undefined>;
  };

  // Validación.
  if (!session_id || typeof session_id !== 'string' || session_id.length < 8) {
    return jsonError('session_id inválido (debe ser UUID o string >= 8 chars)', 400);
  }
  if (!message || typeof message !== 'string') {
    return jsonError('message es requerido', 400);
  }
  const trimmed = message.trim();
  if (!trimmed) return jsonError('message no puede estar vacío', 400);
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    return jsonError(`message excede ${MAX_MESSAGE_LENGTH} caracteres`, 400);
  }

  // Rate limit: 100 mensajes / minuto por user (más estricto que por session).
  const rl = checkRateLimit(`chat:${userId}`, 100, 60_000);
  if (!rl.allowed) {
    return jsonError('Límite de mensajes alcanzado. Espere un minuto.', 429);
  }

  try {
    const conversation = await getOrCreateWebConversation(session_id, {
      userId,
      propertyId: property_id,
      utm: sanitizeUtm(utm),
    });
    const result = await generateAIResponse(conversation, trimmed);

    return NextResponse.json(
      {
        ok: true,
        conversation_id: conversation.id,
        ai_response: result.text,
        lead_score: result.leadScore,
        status: result.promotedToLead ? 'qualified' : conversation.status,
        tools_used: result.toolsUsed,
        promoted_to_lead: result.promotedToLead,
        truncated: result.truncated,
        usage: result.totalUsage,
        rate_limit_remaining: rl.remaining,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error('[/api/chat/test]', err);
    const msg = err instanceof Error ? err.message : 'Error procesando mensaje';
    return jsonError(msg, 500);
  }
}

// GET: health check + info útil.
export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: '/api/chat/test',
    method: 'POST',
    body: '{ session_id: string, message: string, property_id?: string }',
    rate_limit: '100 msg/min por session_id',
  });
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

// Whitelist UTM fields y trim a 200 chars cada uno — defensa contra payload
// abusivo que intente meter strings enormes en columnas text.
function sanitizeUtm(raw: Record<string, string | undefined> | undefined) {
  if (!raw || typeof raw !== 'object') return undefined;
  const ALLOWED = [
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_term',
    'utm_content',
    'referrer',
    'landing_path',
  ] as const;
  const out: Record<string, string> = {};
  for (const k of ALLOWED) {
    const v = raw[k];
    if (typeof v === 'string' && v.length > 0) {
      out[k] = v.slice(0, 200);
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
