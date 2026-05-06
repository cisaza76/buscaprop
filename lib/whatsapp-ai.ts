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
  getConversation,
  type Conversation,
  type ConversationMessage,
} from './ai/conversation';
import { calculateLeadScore, isQualifiedLead } from './ai/scoring';

const MODEL = 'claude-haiku-4-5';
const MAX_TOKENS = 1500; // permitir respuestas más completas (Opción A/B/C)
// Subido de 5 a 10 — el flujo del asesor experto encadena hasta 6-7 tools
// (searchProperties + analyzeNeighborhood + findAlternativeZones +
// recordUserPreferences + a veces fetchPropertyById + getPriceHistory).
// Con cap=5 muchos turns terminaban sin texto final.
const MAX_TOOL_ITERATIONS = 10;

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
  // Set por requestContact tool — fuerza promoción a lead al final del turn.
  let contactRecorded = false;

  // Validar invariante del history rehidratado antes del primer call.
  validateMessages(messages);

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

    // Log de debugging — mostrar el estado de cada iter en stderr.
    if (process.env.AI_DEBUG === '1') {
      const tool_use_count = response.content.filter((b) => b.type === 'tool_use').length;
      const text_count = response.content.filter((b) => b.type === 'text').length;
      console.error(
        `[ai-engine iter ${iter}] stop=${response.stop_reason} text_blocks=${text_count} tool_use=${tool_use_count}`
      );
    }

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

    // Append assistant turn al messages array. CRÍTICO: filtrar response.content
    // a sólo blocks echoables (text + tool_use). Otros tipos de output (thinking,
    // server_tool_use, etc.) NO son válidos como ContentBlockParam y rompen el
    // siguiente call con "tool_use ids were found without tool_result blocks".
    const echoableContent = toEchoableContent(response.content);
    messages.push({ role: 'assistant', content: echoableContent });

    // Ejecutar cada tool y armar el bloque de tool_result.
    // INVARIANTE CRÍTICO: el user message con tool_results DEBE ir inmediatamente
    // después del assistant message con tool_use. Cualquier message intermedio
    // rompe el API.
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolUseBlocks) {
      toolsUsed.push(block.name);
      const exec = await executeTool(
        block.name,
        block.input as Record<string, unknown>,
        { conversationId: conversation.id }
      );
      if (exec.contactRecorded) contactRecorded = true;
      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: exec.result,
        is_error: exec.isError,
      });
      // Persistir el tool result en DB.
      await appendMessage(conversation.id, {
        role: 'tool',
        content: exec.result,
        tool_result: { tool_use_id: block.id, result: exec.result, is_error: exec.isError },
      });
    }

    // Append como user message con todos los tool_results — uno por cada tool_use.
    messages.push({ role: 'user', content: toolResults });

    // Validar invariante antes de la próxima iteración.
    validateMessages(messages);
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

  // Re-leer la conversación para tener preferences + user_phone actualizados
  // (las tools recordUserPreferences y requestContact los updatearon).
  const refreshed = await getConversation(conversation.id);
  const preferences = refreshed?.preferences ?? {};
  const phoneOnRecord = !!refreshed?.user_phone;

  const breakdown = calculateLeadScore({
    userMessageCount: allMessages.filter((m) => m.role === 'user').length,
    userTextCombined: userTexts.toLowerCase(),
    toolsUsed: allToolsUsed,
    visitScheduled: allToolsUsed.includes('scheduleVisit'),
    mentionedProperty: allToolsUsed.includes('fetchPropertyById'),
    contactProvided: contactRecorded || phoneOnRecord,
    preferenceCriteriaCount: Object.keys(preferences).length,
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
 * Filtra response.content (Anthropic.ContentBlock[]) → ContentBlockParam[]
 * dejando sólo los tipos válidos para echoear de vuelta al API en el siguiente
 * turno. Los blocks output-only (thinking, etc.) tienen que descartarse o el
 * API rechaza con 400.
 */
function toEchoableContent(
  blocks: Anthropic.ContentBlock[]
): Anthropic.ContentBlockParam[] {
  const out: Anthropic.ContentBlockParam[] = [];
  for (const b of blocks) {
    if (b.type === 'text') {
      out.push({ type: 'text', text: b.text });
    } else if (b.type === 'tool_use') {
      out.push({
        type: 'tool_use',
        id: b.id,
        name: b.name,
        input: b.input as Record<string, unknown>,
      });
    }
    // Cualquier otro tipo (thinking, server_tool_use, etc.) se descarta.
  }
  return out;
}

/**
 * Verifica el invariante crítico del tool-use loop:
 *   - Para todo tool_use block en un assistant message, debe existir un
 *     tool_result block con el mismo tool_use_id en el SIGUIENTE user message.
 *   - Para todo tool_result block, debe existir un tool_use anterior con id
 *     coincidente.
 *
 * Si se rompe, lanzamos error temprano con un mensaje claro en lugar de
 * dejar que el API devuelva el críptico "tool_use ids were found without
 * tool_result blocks immediately after".
 */
function validateMessages(messages: Anthropic.MessageParam[]): void {
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== 'assistant' || typeof msg.content === 'string') continue;

    const toolUseIds = msg.content
      .filter((b): b is Anthropic.ToolUseBlockParam => b.type === 'tool_use')
      .map((b) => b.id);
    if (toolUseIds.length === 0) continue;

    const next = messages[i + 1];
    if (!next || next.role !== 'user' || typeof next.content === 'string') {
      throw new Error(
        `[validateMessages] assistant[${i}] tiene tool_use ids ${JSON.stringify(toolUseIds)} ` +
          `pero el siguiente message no es un user message con tool_results.`
      );
    }
    const resultIds = next.content
      .filter((b): b is Anthropic.ToolResultBlockParam => b.type === 'tool_result')
      .map((b) => b.tool_use_id);
    const missing = toolUseIds.filter((id) => !resultIds.includes(id));
    if (missing.length > 0) {
      throw new Error(
        `[validateMessages] tool_use ids ${JSON.stringify(missing)} sin tool_result correspondiente ` +
          `en messages[${i + 1}]. resultIds=${JSON.stringify(resultIds)}`
      );
    }
  }
}

/**
 * Convierte el history persistido a formato Anthropic. Compacta los runs de
 * messages role='tool' contiguos en un solo user message con array de
 * tool_result blocks (que es como el API lo espera entre turns).
 *
 * IMPORTANTE: si un assistant message tiene tool_use blocks pero no le sigue
 * ningún tool_result en DB (por una iteración previa que falló), descartamos
 * los tool_use blocks de ese assistant — sólo conservamos el texto. Esto evita
 * mandar al API un par roto que disparó el fix original.
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

      // Verificar si los tool_calls de este assistant tienen tool_result correspondiente
      // en los siguientes messages role='tool'. Si no, descartar los tool_calls
      // (mantenemos sólo el texto) — un tool_use huérfano rompe el siguiente API call.
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        const followingToolResultIds = new Set<string>();
        let j = i + 1;
        while (j < history.length && history[j].role === 'tool') {
          const tr = history[j].tool_result;
          if (tr) followingToolResultIds.add(tr.tool_use_id);
          j++;
        }

        const validToolUses = msg.tool_calls.filter((tc) =>
          followingToolResultIds.has(tc.id)
        );
        const orphanedCount = msg.tool_calls.length - validToolUses.length;
        if (orphanedCount > 0) {
          console.warn(
            `[historyToMessages] descartando ${orphanedCount} tool_use huérfano(s) ` +
              `del assistant message ${msg.id} (sin tool_result correspondiente en DB)`
          );
        }

        for (const tc of validToolUses) {
          blocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: tc.input as Record<string, unknown>,
          });
        }
      }

      // Si no quedó nada (texto vacío + tool_uses huérfanos), saltamos el message.
      if (blocks.length === 0) {
        i++;
        continue;
      }

      out.push({ role: 'assistant', content: blocks });
      i++;
      continue;
    }

    if (msg.role === 'tool') {
      // Compactar runs contiguos de tool messages en un solo user message.
      // Sólo incluir tool_results cuyo tool_use_id aparece en el assistant
      // INMEDIATAMENTE anterior en `out` — descartar huérfanos.
      const prevAssistant = out[out.length - 1];
      const validToolUseIds = new Set<string>();
      if (prevAssistant?.role === 'assistant' && Array.isArray(prevAssistant.content)) {
        for (const b of prevAssistant.content) {
          if (b.type === 'tool_use') validToolUseIds.add(b.id);
        }
      }

      const toolBlocks: Anthropic.ToolResultBlockParam[] = [];
      while (i < history.length && history[i].role === 'tool') {
        const t = history[i];
        if (t.tool_result && validToolUseIds.has(t.tool_result.tool_use_id)) {
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
