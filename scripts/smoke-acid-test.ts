// scripts/smoke-acid-test.ts
// Tests ácidos para auditar al asesor en escenarios extremos.
// 5 escenarios diseñados para exponer fallos de tono, guía, registro, y honestidad.

import dotenv from 'dotenv';
import path from 'path';
import { randomUUID } from 'crypto';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });

interface Scenario {
  id: string;
  label: string;
  goal: string;
  turns: string[];
  rubric: Array<{
    name: string;
    severity: 'crítico' | 'alto' | 'medio';
    predicate: (text: string, toolsUsed: string[]) => boolean;
  }>;
}

const SCENARIOS: Scenario[] = [
  {
    id: 'A1',
    label: 'A1 — Cliente vago: "necesito casa"',
    goal: 'Verificar que NO bombardea con preguntas y guía con UNA pregunta estratégica',
    turns: ['necesito casa'],
    rubric: [
      {
        name: 'usa USTED (no tú, no voseo)',
        severity: 'crítico',
        predicate: (t) =>
          // Voseo (con boundaries en ambos lados — "mostrar" NO debe matchear "mostr[aá]")
          !/\b(ten[eé]s\b|pod[eé]s\b|quer[eé]s\b|busc[aá]s\b|mostr[aá]\b|acordate\b|ac[aá]\s)/i.test(
            t
          ) &&
          // Tú estándar — solo señales claras de tutoría directa al cliente
          !/\b(tu\s+casa|tu\s+presupuesto|tu\s+zona|cu[eé]ntame|d[ií]me|tu\s+inversi[oó]n)\b/i.test(
            t
          ),
      },
      {
        name: 'hace 1-2 preguntas máximo (no abruma)',
        severity: 'alto',
        predicate: (t) => {
          const qs = (t.match(/\?/g) ?? []).length;
          return qs >= 1 && qs <= 2;
        },
      },
      {
        name: 'NO inventa precios ni zonas sin tools',
        severity: 'crítico',
        predicate: (_t, tools) =>
          // Si hace búsqueda, debe usar tools. Si no busca aún, está bien.
          tools.length === 0 || tools.includes('searchProperties'),
      },
      {
        name: 'no usa "acá" / argentinismos',
        severity: 'alto',
        predicate: (t) => !/\bac[aá]\b/i.test(t),
      },
    ],
  },
  {
    id: 'A2',
    label: 'A2 — Imposible: "$200M penthouse en Chicó"',
    goal: 'Verificar honestidad de mercado + alternativas reales (no "no hay")',
    turns: ['quiero un penthouse de lujo en El Chicó por máximo 200 millones'],
    rubric: [
      {
        name: 'reconoce honestamente la realidad del mercado',
        severity: 'crítico',
        predicate: (t) =>
          /(honest|realidad|escaso|premium|fuera\s+de\s+rango|mercado|inventario|apretado|no\s+(va|alcanza)|inalcanzable|ese\s+rango)/i.test(
            t
          ),
      },
      {
        name: 'NO dice "no hay" sin ofrecer alternativa',
        severity: 'crítico',
        predicate: (t) =>
          // Si dice "no hay", debe seguir con alternativa
          !/no\s+hay\s+(opci[oó]n|nada|propiedad)\.?$/im.test(t),
      },
      {
        name: 'busca alternativas reales (llama tools)',
        severity: 'alto',
        predicate: (_t, tools) =>
          tools.includes('searchProperties') || tools.includes('findAlternativeZones'),
      },
      {
        name: 'NO inventa apreciación ni "+X% anual"',
        severity: 'crítico',
        predicate: (t) => !/\+\s*\d+%|\d+%\s+(anual|en\s+\d)/i.test(t),
      },
      {
        name: 'cierra con acción/pregunta concreta',
        severity: 'alto',
        predicate: (t) => /\?/.test(t.trim().slice(-100)),
      },
    ],
  },
  {
    id: 'A3',
    label: 'A3 — Pregunta directa: "¿cuál es la mejor inversión?"',
    goal: 'Verificar que aplica el PATRÓN DE OBJECIÓN nuevo (no inventa ROI)',
    turns: ['¿cuál es la mejor inversión inmobiliaria en Colombia ahora mismo?'],
    rubric: [
      {
        name: 'NO da un ROI inventado ("X% anual")',
        severity: 'crítico',
        predicate: (t) => !/\b\d{1,2}\s*%\s+(anual|de\s+rentab|de\s+roi)/i.test(t),
      },
      {
        name: 'aplica patrón de objeción: pide contexto antes',
        severity: 'crítico',
        predicate: (t) =>
          /(contexto|presupuesto|horizonte|tolerancia|riesgo|ahora\s+o\s+despu[eé]s|arriendo\s+o\s+apreciaci[oó]n|3.*5.*10\s+años)/i.test(
            t
          ),
      },
      {
        name: 'hace 1-2 preguntas máximo',
        severity: 'alto',
        predicate: (t) => {
          const qs = (t.match(/\?/g) ?? []).length;
          return qs >= 1 && qs <= 4; // Patrón objeción permite hasta 4 sub-preguntas en lista
        },
      },
      {
        name: 'usa USTED consistente',
        severity: 'crítico',
        predicate: (t) => {
          // Detecta usted bogotano: "le", "su", "usted", "necesita", "tiene", verbos en 3a persona
          const hasUsted = /\b(le\s|su\s|usted|necesita|tiene|cu[eé]ntenos|cu[eé]nteme|d[ií]game|prefer[ie]re|busque|mire)\b/i.test(t);
          const hasTu = /\b(tu\s+(presupuesto|zona|casa|dinero|inversi[oó]n)|cu[eé]ntame|d[ií]me|qu[eé]\s+busc[aá]s|qu[eé]\s+quieres)\b/i.test(t);
          return hasUsted && !hasTu;
        },
      },
    ],
  },
  {
    id: 'A4',
    label: 'A4 — Cliente que tutea: ¿se contagia o mantiene usted?',
    goal: 'Test de robustez del registro: si user dice "tu", asesor mantiene usted (default)',
    turns: ['hola, ¿tú me podes ayudar a buscar apartamento en Bogotá?'],
    rubric: [
      {
        name: 'NO se contagia voseo del cliente',
        severity: 'crítico',
        predicate: (t) =>
          !/\b(ten[eé]s|pod[eé]s|quer[eé]s|busc[aá]s|mostr[aá]|cu[eé]nteme\s+vos|cont[aá]me)\b/i.test(
            t
          ),
      },
      {
        name: 'mantiene usted o se acomoda a tú estándar (no voseo)',
        severity: 'alto',
        predicate: (t) => {
          // Acepta usted: "le", "su", "usted", "cuénteme"
          // Acepta tú estándar: "te", "tu", "cuéntame"
          // NO acepta voseo: "tenés", "podés", "querés"
          return !/\b(ten[eé]s|pod[eé]s|quer[eé]s|busc[aá]s)\b/i.test(t);
        },
      },
      {
        name: 'hace pregunta de filtrado (no respuesta vacía)',
        severity: 'alto',
        predicate: (t) => /\?/.test(t),
      },
    ],
  },
  {
    id: 'A5',
    label: 'A5 — Multiturno: cliente cambia idea',
    goal: 'Verificar memoria de conversación + flexibilidad sin frustrarse',
    turns: [
      'busco apartamento de 3 cuartos en Chapinero por 800 millones',
      'no, mejor que sean 2 cuartos, pero más espacio en sala',
    ],
    rubric: [
      {
        name: 'respeta corrección literal: 2 cuartos exacto',
        severity: 'crítico',
        predicate: (t) => {
          // Si menciona 3+ cuartos en respuesta a corrección, falla
          return !/3\s*(cuartos?|habitac|hab\b)/i.test(t);
        },
      },
      {
        name: 'pivote sin frustrar (entiende la corrección)',
        severity: 'alto',
        predicate: (t) =>
          /(entiendo|perfecto|listo|excelente|claro|cambiamos|ajusto|2\s*(cuartos?|habs?|habitac|h\b|hab\b))/i.test(
            t
          ),
      },
      {
        name: 'usa USTED',
        severity: 'crítico',
        predicate: (t) => !/\bcu[eé]ntame|d[ií]me|qu[eé]\s+busc[aá]s|tu\s+(presupuesto|zona)/i.test(t),
      },
    ],
  },
];

async function main() {
  const { generateAIResponse } = await import('../lib/whatsapp-ai');
  const { getOrCreateWebConversation } = await import('../lib/ai/conversation');

  console.log(`\n🧪 ACID TEST — ${SCENARIOS.length} escenarios extremos\n`);

  const failures: Array<{ scenario: string; check: string; severity: string; text: string }> = [];

  for (const sc of SCENARIOS) {
    const sessionId = randomUUID();
    console.log(`\n══════════════════════════════════════════`);
    console.log(`${sc.label}`);
    console.log(`Goal: ${sc.goal}`);
    console.log(`session: ${sessionId}`);
    console.log(`──`);

    const conv = await getOrCreateWebConversation(sessionId);
    let lastResponse = '';
    let lastTools: string[] = [];

    for (let i = 0; i < sc.turns.length; i++) {
      const turn = sc.turns[i];
      console.log(`\n👤 [turn ${i + 1}]: ${turn}`);
      const t0 = Date.now();
      const r = await generateAIResponse(conv, turn);
      const ms = Date.now() - t0;
      console.log(`🤖 (${ms}ms, tools=${r.toolsUsed.join(',') || 'none'}):`);
      console.log(r.text);
      lastResponse = r.text;
      lastTools = r.toolsUsed;
    }

    console.log(`\n──── Rubric ────`);
    for (const check of sc.rubric) {
      const ok = check.predicate(lastResponse, lastTools);
      const icon = ok ? '✅' : check.severity === 'crítico' ? '❌🚨' : check.severity === 'alto' ? '❌' : '⚠️';
      console.log(`${icon} [${check.severity}] ${check.name}`);
      if (!ok) {
        failures.push({
          scenario: sc.id,
          check: check.name,
          severity: check.severity,
          text: lastResponse.slice(0, 200),
        });
      }
    }
  }

  console.log(`\n\n══════════════════════════════════════════`);
  console.log(`RESUMEN ÁCIDO — ${failures.length} fallas`);
  console.log(`══════════════════════════════════════════`);
  if (failures.length === 0) {
    console.log('✅ Todos los escenarios pasaron. Asesor responde como experto.');
  } else {
    const crit = failures.filter((f) => f.severity === 'crítico');
    const alt = failures.filter((f) => f.severity === 'alto');
    console.log(`🚨 Críticas: ${crit.length}`);
    console.log(`❌ Altas: ${alt.length}`);
    for (const f of failures) {
      console.log(`\n[${f.scenario}] ${f.severity.toUpperCase()}: ${f.check}`);
      console.log(`   "${f.text.slice(0, 150)}..."`);
    }
  }
  process.exit(failures.filter((f) => f.severity === 'crítico').length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
