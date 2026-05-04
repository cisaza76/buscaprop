import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function main() {
  const { createClient } = await import('@supabase/supabase-js');

  // 1) Service role (bypassea RLS) — confirmamos data
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
  const { count: total } = await sb.from('properties').select('*', { count: 'exact', head: true });
  const { count: nondup } = await sb.from('properties').select('*', { count: 'exact', head: true }).eq('is_duplicate', false);
  console.log('Service role view (sin RLS):');
  console.log('  Total properties:    ', total);
  console.log('  is_duplicate=false:  ', nondup);

  // 2) Anon (browser SIN sesión)
  console.log('\nAnon role (sin sesión):');
  const sbAnon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
  );
  const { count, error } = await sbAnon.from('properties').select('*', { count: 'exact', head: true });
  console.log('  count:', count, '· error:', error?.message ?? 'none', '· code:', (error as any)?.code ?? '-');

  const r = await sbAnon.from('properties').select('id, title').eq('is_duplicate', false).range(0, 4);
  console.log('  SELECT eq(is_duplicate,false): rows=', r.data?.length ?? 0, '· error:', r.error?.message ?? 'none');

  // 3) Listar policies RLS
  console.log('\nRLS policies activas en properties:');
  const { data: pols } = await sb.rpc('pg_policies_for', { table_name: 'properties' }).maybeSingle().then(
    () => ({ data: null }),
    () => ({ data: null })
  );
  // Fallback: query pg_catalog directo
  const { data: rls } = await sb.from('properties').select('id').limit(0);
  console.log('  (info detallada de policies se obtiene desde Supabase Dashboard → Authentication → Policies)');
}
main().catch(e => { console.error(e); process.exit(1); });
