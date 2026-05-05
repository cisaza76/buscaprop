// scripts/smoke-asesor-activo.ts
// Verifica el flujo end-to-end del asesor activo (Phase 7A.1-5):
//   - Links al portal (markdown [txt](url) en respuesta)
//   - System prompt guiado (≥3 criterios → busca directo)
//   - Tool recordUserPreferences (persiste en conversations.preferences)
//   - Tool requestContact (setea user_phone + dispara promoción a lead)
//   - Estados: DISCOVERY → PRESENTING → CLOSING (vía score)

import dotenv from 'dotenv';
import path from 'path';
import { randomUUID } from 'crypto';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });

async function main() {
  const { generateAIResponse } = await import('../lib/whatsapp-ai');
  const { getOrCreateWebConversation, getConversation } = await import('../lib/ai/conversation');

  const sessionId = randomUUID();
  console.log(`\n🧪 Smoke asesor activo`);
  console.log(`   session_id: ${sessionId}\n`);

  const turns = [
    'Quiero apartamento $800M Chapinero garaje',
    'Me interesa el primero',
    'Mi teléfono es 3001234567',
  ];

  let preferencesAfterTurn1: Record<string, unknown> = {};
  let phoneAfterTurn3: string | null = null;
  let scoreFinal = 0;
  let promotedToLead = false;
  let firstResponseText = '';

  for (let i = 0; i < turns.length; i++) {
    const msg = turns[i];
    console.log(`\n──── Turno ${i + 1} ────`);
    console.log(`👤 user: ${msg}`);

    const conv = await getOrCreateWebConversation(sessionId);
    const t0 = Date.now();
    let r;
    try {
      r = await generateAIResponse(conv, msg);
    } catch (err) {
      console.error(`❌ Turno ${i + 1} falló:`, err);
      const m = err instanceof Error ? err.message : String(err);
      if (m.includes('preferences')) {
        console.error(`\n⚠️  Parece que la columna 'preferences' no existe en conversations.`);
        console.error(`   Aplicá la migration 006 en Supabase SQL editor:`);
        console.error(
          `   alter table public.conversations add column if not exists preferences jsonb not null default '{}'::jsonb;`
        );
      }
      process.exit(1);
    }
    const ms = Date.now() - t0;

    console.log(
      `🤖 ai (${ms}ms, score=${r.leadScore}, tools=${r.toolsUsed.join(',') || 'none'}, lead=${
        r.promotedToLead
      }):`
    );
    console.log(r.text);

    if (i === 0) firstResponseText = r.text;

    // Refrescar conv para inspeccionar state.
    const refreshed = await getConversation(conv.id);
    if (i === 0) preferencesAfterTurn1 = (refreshed?.preferences ?? {}) as Record<string, unknown>;
    if (i === 2) {
      phoneAfterTurn3 = refreshed?.user_phone ?? null;
      scoreFinal = r.leadScore;
      promotedToLead = r.promotedToLead;
    }
  }

  console.log(`\n──── Verificaciones ────`);

  let pass = 0;
  let fail = 0;

  // 1. Turn 1 con 3 criterios (apartamento + Chapinero + 800M + garaje) → debe llamar searchProperties.
  const t1HasResults = firstResponseText.length > 50;
  console.log(`${t1HasResults ? '✅' : '❌'} Turn 1 retornó respuesta sustantiva`);
  t1HasResults ? pass++ : fail++;

  // 2. Turn 1 debería incluir markdown link al portal.
  const hasMarkdownLink = /\[.+\]\(https?:\/\/[^\s)]+\)/.test(firstResponseText);
  console.log(
    `${hasMarkdownLink ? '✅' : '❌'} Turn 1 incluye markdown link al portal: ` +
      (hasMarkdownLink ? '(✓)' : '(NO encontrado — chequeá system prompt)')
  );
  hasMarkdownLink ? pass++ : fail++;

  // 3. Después de turn 1, preferences debería tener al menos {city, max_price} o similar.
  const prefKeys = Object.keys(preferencesAfterTurn1);
  const hasCityPref = !!preferencesAfterTurn1.city;
  const hasPricePref = !!preferencesAfterTurn1.max_price;
  console.log(
    `${
      prefKeys.length >= 2 ? '✅' : '⚠️ '
    } preferences after turn 1: ${prefKeys.length} keys → ${JSON.stringify(preferencesAfterTurn1)}`
  );
  prefKeys.length >= 2 ? pass++ : fail++;
  console.log(`   ${hasCityPref ? '✓' : '✗'} city set, ${hasPricePref ? '✓' : '✗'} max_price set`);

  // 4. Después de turn 3, user_phone debe estar set.
  console.log(
    `${
      phoneAfterTurn3 === '3001234567' ? '✅' : '❌'
    } user_phone después del turn 3: ${phoneAfterTurn3 ?? 'null'}`
  );
  phoneAfterTurn3 === '3001234567' ? pass++ : fail++;

  // 5. Score final ≥ 70 → promoted_to_lead true.
  const scoreOk = scoreFinal >= 70 && promotedToLead;
  console.log(
    `${scoreOk ? '✅' : '❌'} Score final ${scoreFinal} → promoted_to_lead=${promotedToLead}`
  );
  scoreOk ? pass++ : fail++;

  console.log(`\n──── Resultado: ${pass}/${pass + fail} pasaron ────`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
