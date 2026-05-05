// scripts/apply-migration-006.ts
// Aplica supabase/migrations/006_conversation_preferences.sql via service_role.
// Si el RPC exec_sql no existe, imprime el SQL para correrlo manual.

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });

async function main() {
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
  const sql = fs.readFileSync(
    path.resolve(process.cwd(), 'supabase/migrations/006_conversation_preferences.sql'),
    'utf-8'
  );
  const { error } = await sb.rpc('exec_sql', { sql });
  if (error) {
    console.log('❌ rpc exec_sql falló:', error.message);
    console.log('   Pegá esto en Supabase SQL editor:');
    console.log('---');
    console.log(sql);
    console.log('---');
    process.exit(1);
  }
  console.log('✅ migration 006 aplicada');

  const { error: e2 } = await sb.from('conversations').select('preferences').limit(1);
  if (e2) {
    console.log('⚠️ verificación falló:', e2.message);
    process.exit(1);
  }
  console.log('✅ columna preferences accesible');
}
main();
