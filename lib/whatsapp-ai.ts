// lib/whatsapp-ai.ts
// Motor conversacional. Anthropic Claude Haiku 4.5 con tool-use manual loop
// + prompt caching del system prompt + tools schema (prefix estable).
//
// Diseño:
// 1. Cargar history de la conversación desde DB
// 2. Convertir history a Anthropic.MessageParam[]
// 3. Loop:
//      a. messages.create(model, system, tools, messages)
//      b. Si stop_reason === 'tool_use': ejecutar tools, append tool_result, repetir
//      c. Si stop_reason === 'end_turn': extraer texto final, salir
// 4. Guardar mensaje del usuario + del asistente (con tool_calls inline) en DB
// 5. Recalcular score y opcionalmente promover a lead
//
// Cap de iteraciones: 5 (suficiente para 1-2 tool calls + respuesta final).
// Si la AI quiere más, retornamos lo que tenga + warning.

import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT } from './ai/system-prompt';
import { TOOLS, executeTool } from './ai/tools';
import {
  appendMessage,
  listMessages,
  updateLeadScore,
  promoteToLead,
  type Conversation,
  type ConversationMessage,
} from './ai/conversation';
import { calculateLeadScore, isQualifiedLead } from './ai/scoring';

const MODEL = 'claude-haiku-4-5';
const MAX_TOKENS = 1024; // respuestas cortas tipo WhatsApp
const MAX_TOOL_ITERATIONS = 5;

// Singleton client. La SDK reusa keep-alive y pool de conexiones.
let cachedClient: Anthropic | null = null;
function getClient(): Anthropic {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Falta ANTHROPIC_API_KEY en .env.local');
  cachedClient = new Anthropic({ apiKey });
  return cachedClient;
}

export interface GenerateAIResponseResult {
  /** Texto final que la AI mostró al usuario. */
  text: string;
  /** Score recalculado después de este turno. */
  leadScore: number;
  /** Si pasó a calificado por primera vez en este turno. */
  promotedToLead: boolean;
  /** Tools que se invocaron en este turno (para debugging / UI). */
  toolsUsed: string[];
  /** Tokens consumidos (suma de todas las llamadas si hubo tool loop). */
  totalUsage: { input: number; output: number; cacheRead: number; cacheCreate: number };
  /** Si llegamos al cap de iteraciones sin respuesta final. */
  truncated: boolean;
}

/**
 * Procesa un nuevo mensaje del usuario:
 * 1. Persiste el mensaje user
 * 2. Llama a la AI con history + tool loop
 * 3. Persiste la respuesta del asistente (incluyendo tool_use/tool_result)
 * 4. Recalcula score y promueve si corresponde
 */
export async function generateAIResponse(
  conversation: Conversation,
  userMessage: string
): Promise<GenerateAIResponseResult> {
  const client = getClient();

  // 1. Persistir mensaje del usuario.
  await appendMessage(conversation.id, { role: 'user', content: userMessage });

  // 2. Cargar history fresca (incluye el mensaje recién insertado).
  const history = await listMessages(conversation.id);

  // 3. Convertir history a formato Anthropic.
  const messages = historyToMessages(history);

  // 4. Tool-use loop.
  const totalUsage = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 };
  const toolsUsed: string[] = [];
  let finalText = '';
  let truncated = true;

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // System prompt + tools cacheados — prefix estable. PostgREST cache a 5 min.
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: TOOLS,
      messages,
    });

    // Acumular usage.
    totalUsage.input += response.usage.input_tokens;
    totalUsage.output += response.usage.output_tokens;
    totalUsage.cacheRead += response.usage.cache_read_input_tokens ?? 0;
    totalUsage.cacheCreate += response.usage.cache_creation_input_tokens ?? 0;

    if (response.stop_reason === 'end_turn' || response.stop_reason === 'max_tokens') {
      // Respuesta final. Persistir y salir.
      const textBlocks = response.content.filter(
        (b): b is Anthropic.TextBlock => b.type === 'text'
      );
      finalText = textBlocks.map((b) => b.text).join('\n').trim();
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
      );
      await appendMessage(conversation.id, {
        role: 'assistant',
        content: finalText,
        tool_calls: toolUseBlocks.length > 0 ? toolUseBlocks : undefined,
        usage: response.usage,
      });
      truncated = false;
      break;
    }

    if (response.stop_reason !== 'tool_use') {
      // Stop reason raro (refusal, pause_turn). Persistir lo que haya y salir.
      const textBlocks = response.content.filter(
        (b): b is Anthropic.TextBlock => b.type === 'text'
      );
      finalText =
        textBlocks.map((b) => b.text).join('\n').trim() ||
        'Disculpa, no puedo ayudarte con eso. ¿Puedo ayudarte buscando una propiedad?';
      await appendMessage(conversation.id, {
        role: 'assistant',
        content: finalText,
        usage: response.usage,
      });
      truncated = false;
      break;
    }

    // stop_reason === 'tool_use': ejecutar TODOS los tool_use blocks.
    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
    );
    const textBlocks = response.content.filter(
      (b): b is Anthropic.TextBlock => b.type === 'text'
    );
    const interimText = textBlocks.map((b) => b.text).join('\n').trim();

    // Persistir mensaje del asistente con sus tool_calls (texto interim + tool_use).
    await appendMessage(conversation.id, {
      role: 'assistant',
      content: interimText,
      tool_calls: toolUseBlocks,
      usage: response.usage,
    });

    // Append assistant turn al messages array (con TODOS los blocks intactos
    // — tool_use blocks deben ir verbatim al siguiente call).
    messages.push({ role: 'assistant', content: response.content });

    // Ejecutar cada tool y armar el bloque de tool_result.
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolUseBlocks) {
      toolsUsed.push(block.name);
      const { result, isError } = await executeTool(
        block.name,
        block.input as Record<string, unknown>
      );
      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: result,
        is_error: isError,
      });
      // Persistir el tool result en DB.
      await appendMessage(conversation.id, {
        role: 'tool',
        content: result,
        tool_result: { tool_use_id: block.id, result, is_error: isError },
      });
    }

    // Append como user message con todos los tool_results.
    messages.push({ role: 'user', content: toolResults });
  }

  // 5. Recalcular score con todas las señales acumuladas.
  const allMessages = await listMessages(conversation.id);
  const userTexts = allMessages
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join(' ');
  const allToolsUsed = allMessages
    .flatMap((m) => m.tool_calls ?? [])
    .map((t) => t.name);

  const breakdown = calculateLeadScore({
    userMessageCount: allMessages.filter((m) => m.role === 'user').length,
    userTextCombined: userTexts.toLowerCase(),
    toolsUsed: allToolsUsed,
    visitScheduled: allToolsUsed.includes('scheduleVisit'),
    mentionedProperty: allToolsUsed.includes('fetchPropertyById'),
  });

  const wasQualified = isQualifiedLead(conversation.lead_score);
  const isNowQualified = isQualifiedLead(breakdown.total);
  const promotedToLead = !wasQualified && isNowQualified;

  await updateLeadScore(
    conversation.id,
    breakdown.total,
    isNowQualified ? 'qualified' : conversation.status
  );

  if (promotedToLead) {
    await promoteToLead({
      conversationId: conversation.id,
      leadScore: breakdown.total,
      propertyId: conversation.property_id ?? undefined,
      agencyId: conversation.agency_id ?? undefined,
      summary: finalText.slice(0, 200),
    });
  }

  return {
    text: finalText || 'No pude generar una respuesta. Intentá reformular la pregunta.',
    leadScore: breakdown.total,
    promotedToLead,
    toolsUsed,
    totalUsage,
    truncated,
  };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Convierte el history persistido a formato Anthropic. Compacta los runs de
 * messages role='tool' contiguos en un solo user message con array de
 * tool_result blocks (que es como el API lo espera entre turns).
 */
function historyToMessages(history: ConversationMessage[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  let i = 0;
  while (i < history.length) {
    const msg = history[i];

    if (msg.role === 'user') {
      out.push({ role: 'user', content: msg.content });
      i++;
      continue;
    }

    if (msg.role === 'assistant') {
      // Reconstruir blocks: si tiene tool_calls, son ToolUseBlock + opcional texto interim.
      const blocks: Array<Anthropic.TextBlockParam | Anthropic.ToolUseBlockParam> = [];
      if (msg.content.trim()) {
        blocks.push({ type: 'text', text: msg.content });
      }
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        for (const tc of msg.tool_calls) {
          blocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: tc.input as Record<string, unknown>,
          });
        }
      }
      out.push({
        role: 'assistant',
        content: blocks.length > 0 ? blocks : msg.content,
      });
      i++;
      continue;
    }

    if (msg.role === 'tool') {
      // Compactar runs contiguos de tool messages en un solo user message.
      const toolBlocks: Anthropic.ToolResultBlockParam[] = [];
      while (i < history.length && history[i].role === 'tool') {
        const t = history[i];
        if (t.tool_result) {
          toolBlocks.push({
            type: 'tool_result',
            tool_use_id: t.tool_result.tool_use_id,
            content: t.tool_result.result,
            is_error: t.tool_result.is_error,
          });
        }
        i++;
      }
      if (toolBlocks.length > 0) {
        out.push({ role: 'user', content: toolBlocks });
      }
      continue;
    }

    i++; // skip unknown
  }
  return out;
}
