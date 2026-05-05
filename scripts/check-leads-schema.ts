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

  // Probar select de cada columna esperada por separado.
  const cols = [
    'id',
    'conversation_id',
    'property_id',
    'agency_id',
    'agent_id',
    'lead_score',
    'status',
    'summary',
  ];
  for (const c of cols) {
    const { error } = await sb.from('leads').select(c).limit(1);
    console.log(`${error ? '❌' : '✅'} ${c}${error ? `: ${error.message}` : ''}`);
  }
}
main();
