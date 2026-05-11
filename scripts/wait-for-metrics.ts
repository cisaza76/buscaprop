// scripts/wait-for-metrics.ts
// Polls scrape_attempts cada 60s hasta que aparezca la primera fila.
// Cuando aparece, imprime y termina. Diseñado para run_in_background.
import './_load-env';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
  const startedAt = Date.now();
  while (Date.now() - startedAt < 45 * 60 * 1000) { // max 45 min
    const { count } = await sb
      .from('scrape_attempts')
      .select('*', { count: 'exact', head: true });
    if ((count ?? 0) > 0) {
      console.log(`[${new Date().toISOString()}] METRICS_LIVE rows=${count}`);
      return;
    }
    console.log(`[${new Date().toISOString()}] still 0 rows, waiting 60s...`);
    await new Promise((r) => setTimeout(r, 60_000));
  }
  console.log(`[${new Date().toISOString()}] TIMEOUT 45min sin filas`);
}
main();
