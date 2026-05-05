// scripts/smoke-asesor-experto.ts
// Tests críticos del system prompt refactoreado (asesor experto Bienes Raíces).
//
// 3 escenarios bloqueantes:
//   1. "Rosales $14-16M arriendo" → reconocer realidad + 2-3 alternativas + acción
//   2. "Casa colonial $800M" → no inviable → opciones inteligentes + justificación
//   3. "Para invertir, no sé dónde" → árbol de preguntas (horizonte / capacidad / diversificación)
//
// Cada test es una sesión SEPARADA (session_id distinto) — sin contaminación.

import dotenv from 'dotenv';
import path from 'path';
import { randomUUID } from 'crypto';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });

interface Test {
  label: string;
  message: string;
  checks: Array<{ name: string; predicate: (text: string) => boolean }>;
}

const TESTS: Test[] = [
  {
    label: 'Test 1 — "Rosales $14-16M arriendo"',
    message:
      'Quiero un apartamento en arriendo en Rosales, presupuesto entre 14 y 16 millones',
    checks: [
      {
        name: 'menciona Rosales por nombre',
        predicate: (t) => /rosales/i.test(t),
      },
      {
        name: 'NO usa frase "no hay opción" (o equivalente cerrado)',
        predicate: (t) =>
          !/no\s+hay\s+(opci[oó]n|nada|propiedades)/i.test(t) &&
          !/no\s+tenemos/i.test(t),
      },
      {
        name: 'incluye al menos 2 propiedades o 2 alternativas',
        predicate: (t) => {
          const opts = (t.match(/🏠|opci[oó]n|alternativa|\$\d+/gi) ?? []).length;
          return opts >= 2;
        },
      },
      {
        name: 'cierra con pregunta o acción concreta',
        predicate: (t) =>
          // Cualquiera de: ? final, chips numerados, palabras de acción
          /\?/.test(t) ||
          /^\s*\d+\.\s/m.test(t) ||
          /(agendar|tel[eé]fono|env[ií]o|cu[eé]ntame|av[ií]same|coordinemos)/i.test(t),
      },
    ],
  },
  {
    label: 'Test 2 — "Casa colonial $800M"',
    message: 'Quiero una casa colonial en Bogotá, presupuesto 800 millones',
    checks: [
      {
        name: 'reconoce honestamente la realidad del mercado',
        predicate: (t) =>
          /honest|realidad|según.*info|mercado|seg[uú]n.*listings|seg[uú]n los datos/i.test(t),
      },
      {
        name: 'NO promete invenciones (apreciación X% en años)',
        predicate: (t) => !/\+\s*\d+%\s+(anual|en \d+ años)/i.test(t),
      },
      {
        name: 'ofrece al menos 1 alternativa con razón',
        predicate: (t) =>
          /alternativa|opci[oó]n|en cambio|otra\s+(zona|opci[oó]n)/i.test(t),
      },
      {
        name: 'cierra con pregunta o acción',
        predicate: (t) =>
          /\?$|\?[^a-z]*$/.test(t.trim()) || /resuena|interesa|prefiere/i.test(t),
      },
    ],
  },
  {
    label: 'Test 3 — "Para invertir, no sé dónde"',
    message: 'Tengo plata para invertir en bienes raíces pero no sé dónde',
    checks: [
      {
        name: 'hace UNA pregunta principal (no 3 simultáneas)',
        predicate: (t) => {
          const qs = (t.match(/\?/g) ?? []).length;
          return qs >= 1 && qs <= 3; // 1-3 signos de pregunta es OK; 4+ es overload
        },
      },
      {
        name:
          'pregunta por horizonte / rentabilidad inmediata vs apreciación / capacidad / diversificación',
        predicate: (t) =>
          /(rentabilidad|arriendo|apreciaci[oó]n|horizonte|3\s*-?\s*5\s*años|inquilino|pasiv[oa]|diversificar|otra ciudad)/i.test(
            t
          ),
      },
      {
        name: 'NO inventa números de ROI / apreciación específicos',
        predicate: (t) => !/\d{1,2}\s*%\s*anual|ROI\s*\d|\+\d+%/i.test(t),
      },
      {
        name: 'tono asesor (no vendedor)',
        predicate: (t) =>
          !/comprar\s+ya|oferta limitada|últimas? unidades|aprovecha/i.test(t),
      },
    ],
  },
];

async function main() {
  const { generateAIResponse } = await import('../lib/whatsapp-ai');
  const { getOrCreateWebConversation } = await import('../lib/ai/conversation');

  console.log(`\n🧪 Smoke asesor experto — ${TESTS.length} tests críticos\n`);

  let totalPass = 0;
  let totalFail = 0;

  for (const test of TESTS) {
    const sessionId = randomUUID();
    console.log(`\n══════════════════════════════════════════`);
    console.log(`${test.label}`);
    console.log(`session: ${sessionId}`);
    console.log(`──`);
    console.log(`👤 user: ${test.message}`);

    const conv = await getOrCreateWebConversation(sessionId);
    const t0 = Date.now();
    const r = await generateAIResponse(conv, test.message);
    const ms = Date.now() - t0;

    console.log(
      `🤖 ai (${ms}ms, tools=${r.toolsUsed.join(',') || 'none'}, score=${r.leadScore}):`
    );
    console.log(r.text);

    console.log(`\n──── Checks ────`);
    for (const check of test.checks) {
      const ok = check.predicate(r.text);
      console.log(`${ok ? '✅' : '❌'} ${check.name}`);
      ok ? totalPass++ : totalFail++;
    }
  }

  console.log(
    `\n══════════════════════════════════════════\nResultado total: ${totalPass}/${totalPass + totalFail} checks pasaron\n`
  );
  process.exit(totalFail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
