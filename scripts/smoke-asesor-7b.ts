// scripts/smoke-asesor-7b.ts
// Smoke E2E del asesor honesto (Phase 7B reducida).
// Verifica que la AI:
//   1. Use analyzeNeighborhood para dar contexto
//   2. Encuadre las opciones contra el promedio del barrio
//   3. Use findComparables cuando el user muestra interés en una opción
//   4. Use simulateCredit cuando el user pregunta financiación
//   5. Incluya disclaimer del crédito
//   6. Incluya checklist de visita antes del cierre
//   7. Use markdown links al portal

import dotenv from 'dotenv';
import path from 'path';
import { randomUUID } from 'crypto';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });

interface ToolCall {
  name: string;
  input: Record<string, unknown>;
}

async function main() {
  const { generateAIResponse } = await import('../lib/whatsapp-ai');
  const { getOrCreateWebConversation } = await import('../lib/ai/conversation');
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const sessionId = randomUUID();
  console.log(`\n🧪 Phase 7B asesor honesto — smoke E2E`);
  console.log(`   session_id: ${sessionId}\n`);

  const turns = [
    'Quiero apartamento en venta en Bogotá, Chapinero, hasta 800M',
    'Me interesa el primero',
    '¿Cuánto pagaría al mes con 30% de inicial a 20 años?',
    'Mi teléfono es 3001234567',
  ];

  const responses: string[] = [];
  const toolCallsByTurn: ToolCall[][] = [];

  for (let i = 0; i < turns.length; i++) {
    const msg = turns[i];
    console.log(`\n──── Turno ${i + 1} ────`);
    console.log(`👤 user: ${msg}`);

    const conv = await getOrCreateWebConversation(sessionId);
    const t0 = Date.now();
    const r = await generateAIResponse(conv, msg);
    const ms = Date.now() - t0;

    console.log(
      `🤖 ai (${ms}ms, score=${r.leadScore}, tools=${r.toolsUsed.join(',') || 'none'}, lead=${
        r.promotedToLead
      }):`
    );
    console.log(r.text);
    responses.push(r.text);

    // Capturar los inputs de los tool_calls para inspección.
    const { data: msgs } = await sb
      .from('conversation_messages')
      .select('role, tool_calls, created_at')
      .eq('conversation_id', conv.id)
      .order('created_at', { ascending: true });
    const allCalls: ToolCall[] = [];
    for (const m of msgs ?? []) {
      if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
        for (const tc of m.tool_calls) {
          allCalls.push({ name: tc.name, input: tc.input });
        }
      }
    }
    // Filtrar las que son nuevas en este turn (las anteriores ya estaban).
    const previousCount = toolCallsByTurn.flat().length;
    toolCallsByTurn.push(allCalls.slice(previousCount));
  }

  console.log(`\n\n──── Verificaciones ────`);
  let pass = 0;
  let fail = 0;

  // 1. Turn 1: searchProperties + analyzeNeighborhood + recordUserPreferences
  const t1Tools = toolCallsByTurn[0].map((t) => t.name);
  const t1HasSearch = t1Tools.includes('searchProperties');
  const t1HasAnalyze = t1Tools.includes('analyzeNeighborhood');
  console.log(
    `${t1HasSearch && t1HasAnalyze ? '✅' : '❌'} Turn 1 usó searchProperties + analyzeNeighborhood (tools: ${t1Tools.join(', ')})`
  );
  t1HasSearch && t1HasAnalyze ? pass++ : fail++;

  // 2. Turn 1 incluye markdown link al portal
  const hasLink = /\[.+\]\(https?:\/\/[^\s)]+\)/.test(responses[0]);
  console.log(`${hasLink ? '✅' : '❌'} Turn 1 incluye markdown link al portal`);
  hasLink ? pass++ : fail++;

  // 3. Turn 1 menciona el promedio del barrio (encuadre)
  const mentionsAvg = /promedio|aproximadamente|\$[\d.]+M|cerca de/i.test(responses[0]);
  console.log(`${mentionsAvg ? '✅' : '❌'} Turn 1 contextualiza precio (menciona promedio/encuadre)`);
  mentionsAvg ? pass++ : fail++;

  // 4. Turn 2: findComparables
  const t2HasComparables = toolCallsByTurn[1].some((t) => t.name === 'findComparables');
  console.log(
    `${t2HasComparables ? '✅' : '⚠️ '} Turn 2 (interés en una propiedad) usó findComparables ` +
      `(tools: ${toolCallsByTurn[1].map((t) => t.name).join(', ') || 'none'})`
  );
  t2HasComparables ? pass++ : fail++;

  // 5. Turn 3: simulateCredit
  const t3HasCredit = toolCallsByTurn[2].some((t) => t.name === 'simulateCredit');
  console.log(
    `${t3HasCredit ? '✅' : '❌'} Turn 3 (pregunta crédito) usó simulateCredit ` +
      `(tools: ${toolCallsByTurn[2].map((t) => t.name).join(', ') || 'none'})`
  );
  t3HasCredit ? pass++ : fail++;

  // 6. Turn 3 incluye disclaimer del crédito
  const hasDisclaimer = /(estimación|estimado|tu banco|tasa.*real|no incluye seguros)/i.test(
    responses[2]
  );
  console.log(
    `${hasDisclaimer ? '✅' : '❌'} Turn 3 incluye disclaimer del crédito (estimado/banco real)`
  );
  hasDisclaimer ? pass++ : fail++;

  // 7. Turn 4: requestContact + score >= 70
  const t4HasContact = toolCallsByTurn[3].some((t) => t.name === 'requestContact');
  console.log(`${t4HasContact ? '✅' : '❌'} Turn 4 usó requestContact`);
  t4HasContact ? pass++ : fail++;

  // 8. Algún mensaje (turn 2-4) menciona checklist de visita / preguntas
  const allText = responses.slice(1).join(' ').toLowerCase();
  const hasCoaching = /(grav[aá]menes|impuestos|administraci[oó]n|escritura|humedad|presi[oó]n del agua)/i.test(
    allText
  );
  console.log(
    `${hasCoaching ? '✅' : '⚠️ '} Algún turno incluye coaching de visita (gravámenes/impuestos/etc)`
  );
  hasCoaching ? pass++ : fail++;

  console.log(`\n──── Resultado: ${pass}/${pass + fail} pasaron ────\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('❌ Smoke falló:', err);
  process.exit(1);
});
