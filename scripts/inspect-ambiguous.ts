import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
config({ path: '.env.local' });
async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
  const ambiguous = ['vicente', 'jeronimo', 'miguel', 'antioquia', 'apartado', 'viboral'];
  for (const c of ambiguous) {
    const { data } = await sb
      .from('properties')
      .select('city, neighborhood, title, source_portal, source_url')
      .eq('city', c)
      .limit(3);
    console.log(`\n=== city='${c}' ===`);
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      console.log(`  ${r.source_portal} · ${r.neighborhood ?? '—'} · ${String(r.title ?? '').slice(0, 80)}`);
      console.log(`    ${r.source_url}`);
    }
  }
}
main();
