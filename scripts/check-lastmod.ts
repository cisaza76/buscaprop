import '/Users/camiloisaza/projects/buscaprop/scripts/_load-env';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
  // Muestra de 10 properties con source_lastmod populated
  const { data } = await sb
    .from('properties')
    .select('source_portal, source_url, source_lastmod, updated_at')
    .not('source_lastmod', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(10);
  console.log('Properties con source_lastmod populated (top 10 más recientes):');
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    console.log(`  ${r.source_portal} · lastmod=${r.source_lastmod} · updated=${r.updated_at}`);
    console.log(`    ${String(r.source_url).slice(0, 80)}`);
  }

  // Distribución por portal
  const { data: byPortal } = await sb
    .from('properties')
    .select('source_portal')
    .not('source_lastmod', 'is', null);
  const counts = new Map<string, number>();
  for (const r of (byPortal ?? []) as Array<{source_portal: string}>) {
    counts.set(r.source_portal, (counts.get(r.source_portal) ?? 0) + 1);
  }
  console.log('\nDistribución por portal:');
  console.table([...counts.entries()].map(([k, v]) => ({ portal: k, count: v })));
}
main();
