// scripts/watch-cache-effect.ts
// Cada 5 min durante 60 min, muestra:
//   - tasa 504 en /api/inngest (vía script auxiliar)
//   - rows en scrape_attempts last 30min
//   - source_lastmod populated en properties (cuánto del cache stack está activo)
// Útil para ver cache-by-lastmod tomando efecto en producción.
import './_load-env';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
  const startedAt = Date.now();
  let iteration = 0;
  while (Date.now() - startedAt < 60 * 60 * 1000) {
    iteration++;
    const now = new Date().toISOString();
    console.log(`\n[iter ${iteration} · ${now}]`);

    // scrape_attempts en últimos 30 min por portal
    const since30 = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data: recent } = await sb
      .from('scrape_attempts')
      .select('portal, error_kind, response_ms')
      .gte('created_at', since30);
    const byPortal = new Map<string, { ok: number; err: number; mss: number[] }>();
    for (const r of (recent ?? []) as Array<{ portal: string; error_kind: string; response_ms: number }>) {
      const e = byPortal.get(r.portal) ?? { ok: 0, err: 0, mss: [] };
      if (r.error_kind === 'ok') {
        e.ok++;
        e.mss.push(r.response_ms);
      } else e.err++;
      byPortal.set(r.portal, e);
    }
    console.log('Last 30min en scrape_attempts:');
    for (const [p, e] of byPortal) {
      const sorted = [...e.mss].sort((a, b) => a - b);
      const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
      const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
      console.log(`  ${p.padEnd(13)} ok=${e.ok} err=${e.err} p50=${p50}ms p95=${p95}ms`);
    }

    // source_lastmod populated count
    const { count: lastmodCount } = await sb
      .from('properties')
      .select('*', { count: 'exact', head: true })
      .not('source_lastmod', 'is', null);
    console.log(`properties con source_lastmod populated: ${lastmodCount ?? 0}`);

    await new Promise((r) => setTimeout(r, 5 * 60 * 1000));
  }
}
main();
