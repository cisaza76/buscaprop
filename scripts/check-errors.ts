import '/Users/camiloisaza/projects/buscaprop/scripts/_load-env';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
  const { data } = await sb
    .from('scrape_attempts')
    .select('portal, url, status_code, error_kind, error_message, created_at')
    .neq('error_kind', 'ok')
    .order('created_at', { ascending: false })
    .limit(15);
  console.log(`Últimos ${(data ?? []).length} errores:`);
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    console.log(`  ${r.created_at}  ${r.portal} · ${r.error_kind}/${r.status_code} · ${String(r.url).slice(0, 75)}`);
    if (r.error_message) console.log(`    msg: ${String(r.error_message).slice(0, 120)}`);
  }
}
main();
