// scripts/smoke-rosales-multiturn.ts
// Reproduce el caso real reportado por el user:
//   Turn 1: "estoy buscando un apto en rosales de $14 millones en arriendo y $2 millones en admin"
//     → AI debe: NO inventar habitaciones. Preguntar UNA vez ("¿cuántas habs?")
//   Turn 2: "2 cuartos"
//     → AI debe: buscar EXACTO 2 cuartos. Mostrar OPCIÓN A/B/C.
//        Cada opción con propiedad concreta + link markdown clickable.
//        NINGUNA opción puede ser de 3+ cuartos.

import dotenv from 'dotenv';
import path from 'path';
import { randomUUID } from 'crypto';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });

interface ToolCallSnapshot {
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
  console.log(`\n🧪 Smoke multi-turn — caso real Rosales $14M+$2M admin`);
  console.log(`   session: ${sessionId}\n`);

  const turns = [
    'estoy buscando un apto en rosales de $14 millones en arriendo y $2 millones en admin',
    '2 cuartos',
  ];

  const responses: string[] = [];
  const toolCallsByTurn: ToolCallSnapshot[][] = [];

  for (let i = 0; i < turns.length; i++) {
    const msg = turns[i];
    console.log(`\n──── Turno ${i + 1} ────`);
    console.log(`👤 user: ${msg}`);

    const conv = await getOrCreateWebConversation(sessionId);
    const t0 = Date.now();
    const r = await generateAIResponse(conv, msg);
    const ms = Date.now() - t0;

    console.log(
      `🤖 ai (${ms}ms, tools=${r.toolsUsed.join(',') || 'none'}):`
    );
    console.log(r.text);
    responses.push(r.text);

    // Capturar tool inputs nuevos del turno actual.
    const { data: msgs } = await sb
      .from('conversation_messages')
      .select('role, tool_calls, created_at')
      .eq('conversation_id', conv.id)
      .order('created_at', { ascending: true });
    const allCalls: ToolCallSnapshot[] = [];
    for (const m of msgs ?? []) {
      if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
        for (const tc of m.tool_calls) {
          allCalls.push({ name: tc.name, input: tc.input });
        }
      }
    }
    const previousCount = toolCallsByTurn.flat().length;
    toolCallsByTurn.push(allCalls.slice(previousCount));
    console.log(`\n  tool inputs:`);
    for (const tc of toolCallsByTurn[i]) {
      const summary = JSON.stringify(tc.input).slice(0, 200);
      console.log(`    ${tc.name}: ${summary}`);
    }
  }

  console.log(`\n\n──── Verificaciones ────`);
  let pass = 0;
  let fail = 0;
  const check = (label: string, ok: boolean) => {
    console.log(`${ok ? '✅' : '❌'} ${label}`);
    ok ? pass++ : fail++;
  };

  // Turn 1: NO debe inventar habitaciones.
  const t1Search = toolCallsByTurn[0].find((c) => c.name === 'searchProperties');
  const t1HasBedroomFilter =
    t1Search &&
    (t1Search.input.min_bedrooms !== undefined ||
      t1Search.input.max_bedrooms !== undefined);
  check(
    'Turn 1: NO inventa habitaciones (no pasa min/max_bedrooms a searchProperties)',
    !t1HasBedroomFilter
  );
  // Turn 1 debe preguntar habitaciones.
  check(
    'Turn 1: pregunta cuántas habitaciones / cuartos',
    /(habitaci[oó]n|cuart|alcoba)/i.test(responses[0]) &&
      /\?/.test(responses[0])
  );

  // Turn 2 (después de "2 cuartos"): debe pasar min_bedrooms=2, max_bedrooms=2.
  const t2Search = toolCallsByTurn[1].find((c) => c.name === 'searchProperties');
  const t2Alt = toolCallsByTurn[1].find((c) => c.name === 'findAlternativeZones');
  const t2SearchOk =
    t2Search &&
    t2Search.input.min_bedrooms === 2 &&
    t2Search.input.max_bedrooms === 2;
  check(
    'Turn 2: searchProperties pasa min=2 Y max=2 (cuartos exactos)',
    !!t2SearchOk
  );
  if (t2Alt) {
    const t2AltOk =
      t2Alt.input.min_bedrooms === 2 && t2Alt.input.max_bedrooms === 2;
    check('Turn 2: findAlternativeZones también respeta min=2, max=2', t2AltOk);
  } else {
    // Si no llamó findAlternativeZones es OK (puede haber encontrado en Rosales).
    console.log(
      'ℹ️  findAlternativeZones no se llamó en turn 2 — quizás searchProperties encontró opciones'
    );
  }

  // Turn 2 debe incluir links markdown clickables.
  const hasMarkdownLinks =
    /\[[^\]]+\]\(https?:\/\/[^\s)]+\)/.test(responses[1]);
  check('Turn 2: respuesta tiene links markdown clickables', hasMarkdownLinks);

  // Turn 2 debe mencionar "admin" o "$2M" o "$16M total" — considerando el costo total.
  const considersAdmin = /(admin|administraci[oó]n|\$16|total\s+mensual)/i.test(
    responses[1]
  );
  check('Turn 2: considera o menciona el admin / costo total', considersAdmin);

  // Turn 2: NO debe mostrar opciones de 3+ cuartos cuando user pidió 2.
  // Buscar patrones tipo "3 cuartos", "3 habs", "3h /", "3h/"
  const has3plus = /\b3\s*(?:cuart|habit|alcoba|h)\b|\b[34567]h\s*\//i.test(
    responses[1]
  );
  check(
    'Turn 2: NO muestra opciones de 3+ cuartos (respeta corrección del user)',
    !has3plus
  );

  console.log(
    `\n──── Resultado: ${pass}/${pass + fail} pasaron ────\n`
  );
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
