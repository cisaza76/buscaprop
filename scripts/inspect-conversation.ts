// scripts/inspect-conversation.ts
// Dump completo de una conversación: timeline user/assistant con tool_calls.
// Uso: npx tsx scripts/inspect-conversation.ts <conversation_id>
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
config({ path: '.env.local' });

async function main() {
  const id = process.argv[2];
  if (!id) {
    console.error('Uso: npx tsx scripts/inspect-conversation.ts <conversation_id>');
    process.exit(1);
  }
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
  const { data } = await sb
    .from('conversation_messages')
    .select('role, content, tool_calls, tool_result, created_at')
    .eq('conversation_id', id)
    .order('created_at', { ascending: true });
  for (const m of (data ?? []) as Array<Record<string, unknown>>) {
    const at = String(m.created_at).slice(11, 19);
    const role = String(m.role).padEnd(9);
    const content = String(m.content ?? '').replace(/\s+/g, ' ').slice(0, 200);
    console.log(`[${at}] ${role} ${content}`);
    const tc = (m.tool_calls as Array<{ name?: string; input?: unknown }> | null) ?? [];
    for (const t of tc) {
      console.log(`              → ${t.name}(${JSON.stringify(t.input).slice(0, 200)})`);
    }
  }
}
main();
