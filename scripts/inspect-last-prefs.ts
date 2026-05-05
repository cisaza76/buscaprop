// scripts/inspect-last-prefs.ts
// Mira el último smoke de conversation y muestra qué pasó con recordUserPreferences.
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });

async function main() {
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
  const { data: convs } = await sb
    .from('conversations')
    .select('id')
    .order('created_at', { ascending: false })
    .limit(1);
  if (!convs || convs.length === 0) {
    console.log('no convs');
    return;
  }
  const convId = convs[0].id;
  console.log('conv:', convId);

  const { data: msgs } = await sb
    .from('conversation_messages')
    .select('role, tool_calls, tool_result')
    .eq('conversation_id', convId)
    .order('created_at', { ascending: true });

  for (const m of msgs ?? []) {
    if (m.role === 'assistant' && m.tool_calls) {
      for (const tc of m.tool_calls) {
        if (tc.name === 'recordUserPreferences' || tc.name === 'requestContact') {
          console.log(`\n[assistant tool_use] ${tc.name}:`);
          console.log('  input:', JSON.stringify(tc.input, null, 2));
        }
      }
    }
    if (m.role === 'tool' && m.tool_result?.result) {
      const r: string = m.tool_result.result;
      if (
        r.includes('preferences') ||
        r.includes('Error al ejecutar') ||
        r.includes('registered')
      ) {
        console.log('\n[tool_result]:');
        console.log(' ', r.slice(0, 500));
      }
    }
  }
}
main();
