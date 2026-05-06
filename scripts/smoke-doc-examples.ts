// scripts/smoke-doc-examples.ts
// Reproduce los 3 ejemplos canónicos del doc GUIA_INTELIGENTE_FLUJO_PREGUNTAS.
// Cada uno valida un flujo distinto del cuestionario:
//   1. Usuario indeciso ("comprar algo en Bogotá no sé qué")
//      → debe hacer pregunta de reconocimiento "vivienda/inversión/ambas"
//   2. Usuario rechaza-todo ("casa colonial Rosales $400M")
//      → debe reconocer realidad + ofrecer alternativas A/B/C
//   3. Inversor agresivo ("invertir $200M máxima rentabilidad")
//      → debe filtrar (rentabilidad ya/después, manejo manual/pasivo)

import dotenv from 'dotenv';
import path from 'path';
import { randomUUID } from 'crypto';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });

interface Test {
  label: string;
  message: string;
  checks: Array<{
    name: string;
    predicate: (text: string, toolsUsed: string[]) => boolean;
  }>;
}

const TESTS: Test[] = [
  {
    label: 'Doc Ejemplo 1 — Usuario indeciso',
    message: 'Quiero comprar algo en Bogotá pero no sé qué',
    checks: [
      {
        name: 'pregunta vivienda/inversión/ambas',
        predicate: (t: string) =>
          /(vivir|inversi[oó]n|invertir|ambas|para qu[eé])/i.test(t) &&
          /\?/.test(t),
      },
      {
        name: 'NO busca todavía (faltan criterios)',
        predicate: (_t: string, tools: string[]) =>
          !tools.includes('searchProperties'),
      },
      {
        name: 'frase bogotana / reconocimiento',
        predicate: (t: string) =>
          /(d[eé]jame|entiendo|panorama|honesto|preciso|claro|empezamos|asesor|orientar|ayudarte|desenredar|nosotros)/i.test(
            t
          ),
      },
      {
        name: 'una pregunta principal (1-3 signos máx)',
        predicate: (t: string) => {
          const qs = (t.match(/\?/g) ?? []).length;
          return qs >= 1 && qs <= 3;
        },
      },
    ],
  },
  {
    label: 'Doc Ejemplo 2 — Casa colonial Rosales $400M (rechazado por mercado)',
    message: 'Hay casa colonial en Rosales por $400M?',
    checks: [
      {
        name: 'reconocimiento honesto del mercado',
        predicate: (t: string) =>
          /(honesto|realidad|premium|escasea|en Rosales|fuera de rango|no encontr[eé]|apretado|directo|ajustad|arriba|escaso)/i.test(
            t
          ),
      },
      {
        name: 'busca propiedades (no descarta sin buscar)',
        predicate: (_t: string, tools: string[]) =>
          tools.includes('searchProperties'),
      },
      {
        name: 'ofrece alternativas inteligentes (al menos 2 zonas)',
        predicate: (t: string) => {
          const altMatches =
            /(usaqu[eé]n|candelaria|macarena|chic[oó]|cabrera|ampliar|presupuesto)/gi;
          const matches = t.match(altMatches) ?? [];
          return matches.length >= 2;
        },
      },
      {
        name: 'cierre con pregunta única',
        predicate: (t: string) => {
          const qs = (t.match(/\?/g) ?? []).length;
          return qs >= 1 && qs <= 3;
        },
      },
    ],
  },
  {
    label: 'Doc Ejemplo 3 — Inversor agresivo',
    message:
      'Quiero invertir $200M en bienes raíces, mejor rentabilidad posible',
    checks: [
      {
        name: 'pregunta horizonte (rentabilidad ya vs después)',
        predicate: (t: string) =>
          /(rentabilidad\s+(ya|ahora|despu[eé]s)|arriendo|apreciaci[oó]n|crece|3[-\s]?5\s*años)/i.test(
            t
          ),
      },
      {
        name: 'NO inventa números de ROI específicos (4-5%, 6-7%, etc.)',
        predicate: (t: string) =>
          !/\b\d{1,2}\s*[\-–]\s*\d{1,2}\s*%\s*anual/i.test(t),
      },
      {
        name: 'una pregunta principal',
        predicate: (t: string) => {
          const qs = (t.match(/\?/g) ?? []).length;
          return qs >= 1 && qs <= 2;
        },
      },
      {
        name: 'tono asesor (no vendedor con urgencia)',
        predicate: (t: string) =>
          !/(comprar\s+ya|oferta limitada|últimas? unidades|aprovecha|no esperes)/i.test(
            t
          ),
      },
    ],
  },
];

async function main() {
  const { generateAIResponse } = await import('../lib/whatsapp-ai');
  const { getOrCreateWebConversation } = await import('../lib/ai/conversation');

  console.log(`\n🧪 Smoke — ejemplos canónicos del doc GUIA_INTELIGENTE\n`);
  let totalPass = 0;
  let totalFail = 0;

  for (const test of TESTS) {
    const sessionId = randomUUID();
    console.log(`\n══════════════════════════════════════════`);
    console.log(test.label);
    console.log(`session: ${sessionId}`);
    console.log(`──`);
    console.log(`👤 user: ${test.message}`);

    const conv = await getOrCreateWebConversation(sessionId);
    const t0 = Date.now();
    const r = await generateAIResponse(conv, test.message);
    const ms = Date.now() - t0;

    console.log(`🤖 ai (${ms}ms, tools=${r.toolsUsed.join(',') || 'none'}):`);
    console.log(r.text);

    console.log(`\n──── Checks ────`);
    for (const check of test.checks) {
      const ok = check.predicate(r.text, r.toolsUsed);
      console.log(`${ok ? '✅' : '❌'} ${check.name}`);
      ok ? totalPass++ : totalFail++;
    }
  }

  console.log(
    `\n══════════════════════════════════════════\nResultado: ${totalPass}/${totalPass + totalFail} checks pasaron\n`
  );
  process.exit(totalFail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
