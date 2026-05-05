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
  const { data: prop } = await sb
    .from('properties')
    .select('id, source_portal')
    .limit(1)
    .maybeSingle();
  if (!prop) {
    console.log('no properties');
    return;
  }
  const { data, error } = await sb
    .from('property_history')
    .insert({
      property_id: prop.id,
      price_cop: 999999999,
      source_portal: prop.source_portal,
    })
    .select('id')
    .single();
  if (error) {
    console.log('❌ insert error:', error.message);
    process.exit(1);
  }
  console.log('✅ insert OK, id:', data.id);
  await sb.from('property_history').delete().eq('id', data.id);
  console.log('✅ cleanup OK');
}
main();
