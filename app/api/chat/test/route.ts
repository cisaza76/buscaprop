// app/api/chat/test/route.ts
// Endpoint POST para probar el chatbot AI desde el web widget.
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
// Auth: ninguna en MVP — gated por session_id (browser-generated UUID).
// Cuando expongamos esto en producción, agregar Bearer token o Supabase auth.

import { NextResponse, type NextRequest } from 'next/server';
import { generateAIResponse } from '@/lib/whatsapp-ai';
import { getOrCreateWebConversation, checkRateLimit } from '@/lib/ai/conversation';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // segundos. Tool loop puede tomar 30-50s en peor caso.

const MAX_MESSAGE_LENGTH = 2000;

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError('Body debe ser JSON válido', 400);
  }

  const { session_id, message, property_id } = body as {
    session_id?: string;
    message?: string;
    property_id?: string;
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

  // Rate limit: 100 mensajes / minuto / session_id.
  const rl = checkRateLimit(`chat:${session_id}`, 100, 60_000);
  if (!rl.allowed) {
    return jsonError('Límite de mensajes alcanzado. Espere un minuto.', 429);
  }

  try {
    const conversation = await getOrCreateWebConversation(session_id, property_id);
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
