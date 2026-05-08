import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
config({ path: '.env.local' });

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
  // Check distinct listing_type values + counts
  const { data: sample } = await sb
    .from('properties')
    .select('listing_type, source_portal')
    .eq('is_duplicate', false)
    .limit(3000);
  const byPair = new Map<string, number>();
  for (const r of (sample ?? []) as Array<{ listing_type: string | null; source_portal: string | null }>) {
    const k = `${r.source_portal ?? 'null'} / ${r.listing_type ?? 'null'}`;
    byPair.set(k, (byPair.get(k) ?? 0) + 1);
  }
  console.log('listing_type × source_portal (3000-sample):');
  console.table([...byPair.entries()].sort((a,b) => b[1]-a[1]).map(([k,v]) => ({pair: k, count: v})));
}
main();
