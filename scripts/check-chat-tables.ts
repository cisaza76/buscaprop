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

  for (const table of ['conversations', 'conversation_messages', 'leads']) {
    const { error, count } = await sb.from(table).select('*', { count: 'exact', head: true });
    if (error) {
      console.log(`❌ ${table}: ${error.message} (code ${error.code})`);
    } else {
      console.log(`✅ ${table}: existe (${count} rows)`);
    }
  }
}
main();
