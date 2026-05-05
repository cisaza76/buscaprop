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

  // Probar lectura.
  const { data, error } = await sb.from('conversations').select('id, preferences').limit(1);
  if (error) {
    console.log('❌ select preferences falló:', error.message);
    process.exit(1);
  }
  console.log(`✅ Columna 'preferences' existe en conversations.`);
  console.log(`   Sample row:`, data?.[0]);

  // Probar update con dummy payload sobre una row arbitraria.
  if (data && data[0]) {
    const id = data[0].id;
    const { error: e2 } = await sb
      .from('conversations')
      .update({ preferences: { test: 'hola' } })
      .eq('id', id);
    if (e2) {
      console.log('❌ update preferences falló:', e2.message);
      process.exit(1);
    }
    console.log(`✅ update preferences OK sobre row ${id}`);
    // Revertir.
    await sb.from('conversations').update({ preferences: {} }).eq('id', id);
  }
}
main();
