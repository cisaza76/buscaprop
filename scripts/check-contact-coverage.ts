import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function main() {
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  // 1. ¿Existe la columna contact_phone? (migration 004 corrida?)
  const { error: colErr } = await sb.from('properties').select('contact_phone').limit(1);
  if (colErr) {
    console.log('❌ Migration 004 NO aplicada — columna contact_phone no existe');
    console.log('   Para activar: copiar/pegar supabase/migrations/004_add_contact_fields.sql en Supabase SQL Editor → Run');
    return;
  }
  console.log('✅ Migration 004 aplicada (columnas existen)');

  // 2. Coverage por portal
  console.log('\n═══ Cobertura contact_phone por portal ═══');
  for (const portal of ['fincaraiz', 'metrocuadrado', 'properati', 'ciencuadras']) {
    const { count: total } = await sb.from('properties').select('*', { count: 'exact', head: true }).eq('source_portal', portal);
    const { count: withPhone } = await sb.from('properties').select('*', { count: 'exact', head: true }).eq('source_portal', portal).not('contact_phone', 'is', null);
    const { count: withName } = await sb.from('properties').select('*', { count: 'exact', head: true }).eq('source_portal', portal).not('contact_name', 'is', null);
    const { count: withCompany } = await sb.from('properties').select('*', { count: 'exact', head: true }).eq('source_portal', portal).not('company_name', 'is', null);
    const pct = (a: number | null, b: number | null) => (b && b > 0 ? Math.round(100 * (a ?? 0) / b) : 0);
    console.log(`  ${portal.padEnd(15)} total ${total} · phone ${withPhone} (${pct(withPhone, total)}%) · name ${withName} (${pct(withName, total)}%) · company ${withCompany} (${pct(withCompany, total)}%)`);
  }

  // 3. Sample de uno con phone real (para validar wa.me URL)
  const { data: sample } = await sb.from('properties')
    .select('id, source_portal, title, contact_phone, contact_name, company_name')
    .not('contact_phone', 'is', null)
    .limit(3);
  console.log('\n═══ Samples con contact_phone ═══');
  if (!sample?.length) {
    console.log('  Ningún listing tiene contact_phone aún. Run:');
    console.log('    npx tsx scripts/scrape-once.ts --portal metrocuadrado --refresh-contacts');
    return;
  }
  for (const r of sample) {
    console.log(`  [${r.source_portal}] ${r.title?.slice(0, 50)}`);
    console.log(`    id: ${r.id}`);
    console.log(`    phone: ${r.contact_phone}`);
    console.log(`    name: ${r.contact_name ?? '—'} · company: ${r.company_name ?? '—'}`);
    console.log(`    wa.me link: https://wa.me/${r.contact_phone}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
