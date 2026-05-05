// scripts/smoke-chat-multiturn.ts
// Verifica que historyToMessages() rehidrate correctamente una conversación
// con tool_use + tool_result previos. Ejecuta 3 turnos secuenciales en la
// misma session_id — el segundo y tercero rebuilds el history desde DB.

import dotenv from 'dotenv';
import path from 'path';
import { randomUUID } from 'crypto';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });

async function main() {
  const { generateAIResponse } = await import('../lib/whatsapp-ai');
  const { getOrCreateWebConversation } = await import('../lib/ai/conversation');

  const sessionId = randomUUID();
  console.log(`\n🧪 Multi-turn smoke test`);
  console.log(`   session_id: ${sessionId}\n`);

  const conv = await getOrCreateWebConversation(sessionId);
  const turns = [
    'Quiero apartamentos en Chapinero por menos de 800M',
    '¿Cuáles tienen 3 habitaciones?',
    'Me interesa visitar el primero',
  ];

  for (let i = 0; i < turns.length; i++) {
    const msg = turns[i];
    console.log(`\n──── Turno ${i + 1} ────`);
    console.log(`👤 user: ${msg}`);

    const t0 = Date.now();
    try {
      // Refrescar conversation row entre turnos para que score esté al día.
      const fresh = await getOrCreateWebConversation(sessionId);
      const r = await generateAIResponse(fresh, msg);
      const ms = Date.now() - t0;
      console.log(`🤖 ai (${ms}ms, ${r.toolsUsed.join(',') || 'no-tools'}, score=${r.leadScore}):`);
      console.log(r.text);
      if (r.truncated) {
        console.log(`❌ truncated`);
        process.exit(1);
      }
    } catch (err) {
      console.error(`❌ Turno ${i + 1} falló:`, err);
      process.exit(1);
    }
  }

  console.log(`\n✅ Multi-turn smoke test completó OK.`);
  process.exit(0);
}

main();
