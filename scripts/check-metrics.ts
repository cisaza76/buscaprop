// scripts/check-metrics.ts
// Verifica que scrape_attempts está recibiendo rows de los scrapers en prod.
import './_load-env';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  // Total y latest timestamp
  const { count } = await sb
    .from('scrape_attempts')
    .select('*', { count: 'exact', head: true });
  console.log(`Total rows en scrape_attempts: ${count ?? 0}`);

  if ((count ?? 0) === 0) {
    console.log('\n⏳ Aún sin filas. El próximo tick del cron (≤30 min) las generará.');
    console.log('   (Inngest funciones warm-state pueden tardar 1-2 ticks en reciclar.)');
    return;
  }

  // Distribución por portal × error_kind, últimas 2h
  const { data: byKind } = await sb
    .from('scrape_attempts')
    .select('portal, error_kind')
    .gte('created_at', new Date(Date.now() - 2 * 3600 * 1000).toISOString());

  const agg = new Map<string, number>();
  for (const r of (byKind ?? []) as Array<{ portal: string; error_kind: string }>) {
    const key = `${r.portal} / ${r.error_kind}`;
    agg.set(key, (agg.get(key) ?? 0) + 1);
  }

  console.log('\nDistribución últimas 2h (portal / error_kind):');
  console.table(
    [...agg.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => ({ pair: k, count: v }))
  );

  // Latencia p95 por portal en últimas 2h (solo 'ok')
  const { data: ok } = await sb
    .from('scrape_attempts')
    .select('portal, response_ms')
    .eq('error_kind', 'ok')
    .gte('created_at', new Date(Date.now() - 2 * 3600 * 1000).toISOString());

  const byPortal = new Map<string, number[]>();
  for (const r of (ok ?? []) as Array<{ portal: string; response_ms: number }>) {
    const arr = byPortal.get(r.portal) ?? [];
    arr.push(r.response_ms);
    byPortal.set(r.portal, arr);
  }

  const stats: Array<{ portal: string; n: number; p50: number; p95: number; max: number }> = [];
  for (const [portal, mss] of byPortal) {
    mss.sort((a, b) => a - b);
    const p = (q: number) => mss[Math.min(mss.length - 1, Math.floor(mss.length * q))];
    stats.push({
      portal,
      n: mss.length,
      p50: p(0.5),
      p95: p(0.95),
      max: mss[mss.length - 1],
    });
  }
  console.log('\nLatencia (ms) últimas 2h, solo requests 200 ok:');
  console.table(stats);

  // Última row insertada — para confirmar que el writer está vivo
  const { data: latest } = await sb
    .from('scrape_attempts')
    .select('portal, url, status_code, response_ms, error_kind, created_at')
    .order('created_at', { ascending: false })
    .limit(3);
  console.log('\nÚltimos 3 attempts:');
  for (const r of (latest ?? []) as Array<Record<string, unknown>>) {
    console.log(`  ${r.created_at}  ${r.portal} · ${r.error_kind} · ${r.response_ms}ms · ${String(r.url).slice(0, 70)}`);
  }
}
main();
