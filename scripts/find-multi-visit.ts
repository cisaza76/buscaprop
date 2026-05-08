import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
config({ path: '.env.local' });

interface ToolUse { type?: string; name?: string; input?: Record<string, unknown>; }

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
  // Buscar conversaciones recientes con ≥ 2 scheduleVisit calls
  const { data: msgs } = await sb
    .from('conversation_messages')
    .select('conversation_id, role, content, tool_calls, created_at')
    .eq('role', 'assistant')
    .order('created_at', { ascending: false })
    .limit(500);
  const buckets = new Map<string, Array<{ when: string | null; prop: string | null; msg_at: string }>>();
  for (const m of (msgs ?? []) as Array<{ conversation_id: string; tool_calls: ToolUse[] | null; content: string; created_at: string }>) {
    const tc = (m.tool_calls ?? []).filter((t) => t.name === 'scheduleVisit');
    for (const t of tc) {
      const arr = buckets.get(m.conversation_id) ?? [];
      arr.push({
        when: typeof t.input?.preferred_when === 'string' ? t.input.preferred_when : null,
        prop: typeof t.input?.property_id === 'string' ? t.input.property_id : null,
        msg_at: m.created_at,
      });
      buckets.set(m.conversation_id, arr);
    }
  }
  const multi = [...buckets.entries()].filter(([, v]) => v.length >= 2);
  console.log(`Conversaciones con ≥2 scheduleVisit (últimos 500 msgs assistant): ${multi.length}\n`);
  for (const [convId, calls] of multi.slice(0, 5)) {
    console.log(`Conv ${convId}:`);
    for (const c of calls) {
      console.log(`  ${c.msg_at}  preferred_when='${c.when}'  prop=${c.prop?.slice(0, 8)}…`);
    }
    console.log();
  }
}
main();
