// scripts/check-scraper-cursor.ts
// Lee el estado actual del scraper_cursor — útil para ver si un portal
// quedó atascado o reportó error en el último tick.
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
config({ path: '.env.local' });

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
  const { data, error } = await sb.from('scraper_cursor').select('*').order('portal');
  if (error) {
    console.error(error);
    process.exit(1);
  }
  console.table(data);
}
main();
