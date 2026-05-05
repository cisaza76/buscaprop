// scripts/smoke-chat.ts
// Smoke test directo del motor conversacional. No usa el endpoint HTTP — llama
// generateAIResponse() directo, así reproducimos el bug de tool-use sin pasar
// por Next.js.
//
// Uso: tsx scripts/smoke-chat.ts "Quiero comprar apartamento $800M en Bogotá La Cabrera"

import dotenv from 'dotenv';
import path from 'path';
import { randomUUID } from 'crypto';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });

async function main() {
  const userMessage =
    process.argv[2] ?? 'Quiero comprar apartamento $800M en Bogotá La Cabrera';
  console.log(`\n🧪 Smoke test del chatbot`);
  console.log(`   Mensaje: "${userMessage}"\n`);

  // Import dinámico para que dotenv haya cargado las env vars antes.
  const { generateAIResponse } = await import('../lib/whatsapp-ai');
  const { getOrCreateWebConversation } = await import('../lib/ai/conversation');

  // session_id nuevo = conversación limpia (no arrastra history roto).
  const sessionId = randomUUID();
  console.log(`   session_id: ${sessionId}`);

  const conv = await getOrCreateWebConversation(sessionId);
  console.log(`   conversation: ${conv.id}\n`);

  const t0 = Date.now();
  try {
    const result = await generateAIResponse(conv, userMessage);
    const ms = Date.now() - t0;

    console.log(`✅ AI response (${ms}ms):\n`);
    console.log(result.text);
    console.log(`\n📊 Lead score: ${result.leadScore}`);
    console.log(`🛠️  Tools usadas: ${result.toolsUsed.join(', ') || '(ninguna)'}`);
    console.log(`📈 Promovido a lead: ${result.promotedToLead ? 'sí' : 'no'}`);
    console.log(`⚠️  Truncado: ${result.truncated ? 'sí' : 'no'}`);
    console.log(
      `💰 Tokens: input=${result.totalUsage.input} output=${result.totalUsage.output} ` +
        `cacheRead=${result.totalUsage.cacheRead} cacheCreate=${result.totalUsage.cacheCreate}`
    );

    if (result.toolsUsed.length === 0) {
      console.log(`\n⚠️  La AI no invocó searchProperties — el test es inconcluso.`);
      process.exit(1);
    }
    if (result.truncated) {
      console.log(`\n❌ Llegó al cap de iteraciones sin respuesta final.`);
      process.exit(1);
    }
    console.log(`\n✅ Tool-use loop completó OK.`);
    process.exit(0);
  } catch (err) {
    const ms = Date.now() - t0;
    console.error(`\n❌ ERROR (${ms}ms):`);
    console.error(err);
    process.exit(1);
  }
}

main();
