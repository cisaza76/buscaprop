// scripts/check-residual-lowercase.ts
// ¿Las 27 rows con city lowercase son viejas (pre-fix) o nuevas (post-deploy,
// = bug en el codepath)? Si son nuevas, el fix de upsertProperty se está
// pasando por alto en algún lado.
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
config({ path: '.env.local' });

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
  const cities = [
    'pedro','guatape','manizales','tulua','necocli','armenia','yarumal',
    'fredonia','cocorna','sopetran','penol','belalcazar','candelaria',
    'ebejico','sitionuevo','buenavista','colombia','soledad','versalles',
    'aires','isabel','rosario','macarena','venecia','domingo',
  ];
  const { data, error } = await sb
    .from('properties')
    .select('city, source_portal, created_at, updated_at, scraped_at, source_url')
    .in('city', cities)
    .eq('is_duplicate', false)
    .order('updated_at', { ascending: false });
  if (error) { console.error(error); process.exit(1); }
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  console.log(`Total rows: ${rows.length}\n`);
  // Resumen por fecha de updated_at
  const buckets = { 'today (post-deploy)': 0, 'last 24h': 0, 'last 7d': 0, 'older': 0 };
  const deployTime = new Date('2026-05-08T01:30:00Z'); // approximated
  const now = Date.now();
  for (const r of rows) {
    const u = new Date(r.updated_at as string).getTime();
    if (u > deployTime.getTime()) buckets['today (post-deploy)']++;
    else if (now - u < 24 * 3600 * 1000) buckets['last 24h']++;
    else if (now - u < 7 * 24 * 3600 * 1000) buckets['last 7d']++;
    else buckets['older']++;
  }
  console.log('Distribución temporal de updated_at:');
  console.table(buckets);

  console.log('\nMuestra (ordenadas por updated_at desc):');
  for (const r of rows.slice(0, 10)) {
    console.log(`  ${r.updated_at}  ${r.source_portal} · '${r.city}'`);
    console.log(`    ${r.source_url}`);
  }
}
main();
