import dotenv from 'dotenv';
import path from 'path';
import { randomUUID } from 'crypto';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });

process.env.AI_DEBUG = '1';

async function main() {
  const { generateAIResponse } = await import('../lib/whatsapp-ai');
  const { getOrCreateWebConversation } = await import('../lib/ai/conversation');
  const conv = await getOrCreateWebConversation(randomUUID());
  console.log('\n👤 user: Quiero invertir 200M, mejor rentabilidad\n');
  const r = await generateAIResponse(
    conv,
    'Quiero invertir 200M en bienes raíces, mejor rentabilidad posible'
  );
  console.log('\nfinal text length:', r.text.length);
  console.log('truncated:', r.truncated);
  console.log('tools used:', r.toolsUsed);
  console.log('\ntext:\n', r.text);
}
main().catch((e) => console.error('❌', e));
