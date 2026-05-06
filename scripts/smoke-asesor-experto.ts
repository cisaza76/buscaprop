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
  checks: Array<{
    name: string;
    predicate: (text: string, toolsUsed: string[]) => boolean;
  }>;
}

const TESTS: Test[] = [
  {
    label: 'Test 1 — "Rosales $14M arriendo 3 cuartos" (caso reportado por user)',
    message: 'Quiero apartamento en Rosales, $14M en arriendo de 3 cuartos',
    checks: [
      {
        name: 'llama searchProperties (intentó en Rosales primero)',
        predicate: (_t: string, tools: string[]) => tools.includes('searchProperties'),
      },
      {
        name: 'llama findAlternativeZones (no preguntó, BUSCÓ)',
        predicate: (_t: string, tools: string[]) =>
          tools.includes('findAlternativeZones'),
      },
      {
        name: 'menciona al menos 1 barrio alternativo real (Chicó / La Cabrera / etc.)',
        predicate: (t: string) =>
          /(chic[oó]|la\s+cabrera|el\s+nogal|quinta\s+camacho|el\s+refugio|country\s+club)/i.test(
            t
          ),
      },
      {
        name: 'NO inventa alternativas pidiendo permiso ("¿quiere que mire en X?" / "¿querés que...?")',
        predicate: (t: string) =>
          !/[¿?]?\s*(quer[eé]s|prefer[ií]s|quiere|prefiere|le\s+(muestro|busco)|te\s+(muestro|busco))\s+(que\s+)?(mire|veamos|busquemos|ver|explorar)\s+(alternativas|en\s+otros|en\s+barrios|en\s+\w+)/i.test(
            t
          ),
      },
      {
        name: 'reconocimiento honesto al inicio (frase tipo "Le voy a ser honesto" / "realidad" / "premium")',
        predicate: (t: string) =>
          /(le\s+voy\s+a\s+ser\s+honesto|para\s+serle\s+honesto|te\s+voy\s+a\s+ser\s+honesto|honesto|aqu[ií]\s+est[aá]\s+la\s+realidad|ac[aá]\s+est[aá]\s+la\s+realidad|perm[ií]tame\s+(mostrar|ayudar)|d[eé]jame\s+ayudarte|he\s+visto\s+esto|panorama|realidad\s+del\s+mercado|premium|escaso|inventario\s+real)/i.test(
            t
          ),
      },
      {
        name: 'menciona Rosales explícitamente en los primeros 250 chars (regla #16)',
        predicate: (t: string) => /rosales/i.test(t.slice(0, 250)),
      },
      {
        name: 'incluye al menos UNA propiedad con link markdown clickable',
        predicate: (t: string) => /\[[^\]]+\]\(https?:\/\/[^\s)]+\)/.test(t),
      },
      {
        name: 'NO muestra precios irrelevantes muy abajo del rango pedido (bug $2-8M en rango $14M)',
        predicate: (t: string) => {
          // Buscar promedios/rangos abajo de $9M (70% de $14M = $9.8M).
          const lowPrice =
            /(promedio|rango|desde|opciones?\s+(?:a|de))[^.\n]{0,30}\$[1-8](?:[.,]\d+)?\s*M\b/i;
          return !lowPrice.test(t);
        },
      },
      {
        name: 'cierra con pregunta única (1-2 signos máximo)',
        predicate: (t: string) => {
          const qs = (t.match(/\?/g) ?? []).length;
          return qs >= 1 && qs <= 2;
        },
      },
    ],
  },
  {
    label: 'Test 2 — "Casa colonial $800M"',
    message: 'Quiero una casa colonial en Bogotá, presupuesto 800 millones',
    checks: [
      {
        name: 'reconoce honestamente la realidad del mercado',
        predicate: (t: string) =>
          /honest|realidad|según.*info|mercado|seg[uú]n.*listings|seg[uú]n los datos/i.test(t),
      },
      {
        name: 'NO promete invenciones (apreciación X% en años)',
        predicate: (t: string) => !/\+\s*\d+%\s+(anual|en \d+ años)/i.test(t),
      },
      {
        name: 'ofrece al menos 1 alternativa con razón',
        predicate: (t: string) =>
          /alternativa|opci[oó]n|en cambio|otra\s+(zona|opci[oó]n)|ampliar\s+presupuesto|sin\s+l[ií]mite|candelaria|usaqu[eé]n\s+antiguo|si\s+el\s+\w+\s+es\s+no\s+negociable/i.test(
            t
          ),
      },
      {
        name: 'cierra con pregunta o acción',
        predicate: (t: string) => {
          // Acepta pregunta en cualquier parte (no solo al final), o palabras de cierre.
          const hasAnyQuestion = /\?/.test(t);
          const hasClosePhrase = /resuena|interesa|prefiere|le\s+late|d[ií]game|cu[eé]nteme/i.test(
            t
          );
          return hasAnyQuestion || hasClosePhrase;
        },
      },
    ],
  },
  {
    label: 'Test 3 — "Para invertir, no sé dónde"',
    message: 'Tengo plata para invertir en bienes raíces pero no sé dónde',
    checks: [
      {
        name: 'hace UNA pregunta principal (no 3 simultáneas)',
        predicate: (t: string) => {
          const qs = (t.match(/\?/g) ?? []).length;
          return qs >= 1 && qs <= 2; // 1-2 max — más es overload
        },
      },
      {
        name:
          'pregunta por horizonte / rentabilidad inmediata vs apreciación / capacidad / diversificación',
        predicate: (t: string) =>
          /(rentabilidad|arriendo|apreciaci[oó]n|horizonte|3\s*-?\s*5\s*años|inquilino|pasiv[oa]|diversificar|otra ciudad)/i.test(
            t
          ),
      },
      {
        name: 'NO inventa números de ROI / apreciación específicos',
        predicate: (t: string) => !/\d{1,2}\s*%\s*anual|ROI\s*\d|\+\d+%/i.test(t),
      },
      {
        name: 'tono asesor (no vendedor)',
        predicate: (t: string) =>
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
      const ok = check.predicate(r.text, r.toolsUsed);
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
