// scripts/check-history-table.ts
// Verifica que la migration 008 esté aplicada.
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
  const { error, count } = await sb
    .from('property_history')
    .select('*', { count: 'exact', head: true });
  if (error) {
    console.log(`❌ property_history: ${error.message}`);
    console.log('\n   Aplicá supabase/migrations/008_property_history.sql en Supabase SQL editor.');
    process.exit(1);
  }
  console.log(`✅ property_history existe (${count} rows)`);

  // Verificar la vista.
  const { error: vErr } = await sb
    .from('property_latest_snapshot')
    .select('*', { count: 'exact', head: true });
  if (vErr) {
    console.log(`⚠️  vista property_latest_snapshot: ${vErr.message}`);
  } else {
    console.log(`✅ vista property_latest_snapshot accesible`);
  }
}
main();
