import './_load-env';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const since6 = new Date(Date.now() - 6 * 3_600_000).toISOString();
  const since24 = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const since7d = new Date(Date.now() - 7 * 86_400_000).toISOString();

  console.log('\n━━ scrape_attempts por portal (count exacto, 6h) ━━');
  for (const portal of ['fincaraiz', 'ciencuadras', 'metrocuadrado', 'properati']) {
    const { count } = await sb
      .from('scrape_attempts')
      .select('*', { count: 'exact', head: true })
      .eq('portal', portal)
      .gte('created_at', since6);
    console.log(`  ${portal.padEnd(15)} ${(count || 0).toLocaleString()} attempts`);
  }

  console.log('\n━━ scrape_attempts por portal (count exacto, 24h) ━━');
  for (const portal of ['fincaraiz', 'ciencuadras', 'metrocuadrado', 'properati']) {
    const { count } = await sb
      .from('scrape_attempts')
      .select('*', { count: 'exact', head: true })
      .eq('portal', portal)
      .gte('created_at', since24);
    console.log(`  ${portal.padEnd(15)} ${(count || 0).toLocaleString()} attempts`);
  }

  console.log('\n━━ Verifica que check-scraper-health se trunca: TOP de cada portal (sin filtro) ━━');
  // Sin filtro de portal, .limit(100_000), reproducir lo que hace check-scraper-health
  const { data: trunc, error } = await sb
    .from('scrape_attempts')
    .select('portal, status_code')
    .gte('created_at', since6)
    .limit(100_000);
  if (error) console.error(error);
  const counts = new Map<string, number>();
  for (const r of trunc || []) counts.set(r.portal!, (counts.get(r.portal!) || 0) + 1);
  console.log(`  Devuelto: ${(trunc || []).length} rows (cap PostgREST ~1000)`);
  for (const [p, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${p.padEnd(15)} ${n.toLocaleString()}`);
  }

  console.log('\n━━ Properati: distribución error_kind (24h) ━━');
  // Pagino properati explícito
  let from = 0; const pageSize = 1000;
  const kinds = new Map<string, number>();
  let total = 0;
  while (true) {
    const { data, error } = await sb
      .from('scrape_attempts')
      .select('error_kind')
      .eq('portal', 'properati')
      .gte('created_at', since24)
      .range(from, from + pageSize - 1);
    if (error) { console.error(error); break; }
    if (!data || data.length === 0) break;
    for (const r of data) { kinds.set(r.error_kind, (kinds.get(r.error_kind) || 0) + 1); total++; }
    if (data.length < pageSize) break;
    from += pageSize;
  }
  console.log(`  Total properati attempts 24h: ${total.toLocaleString()}`);
  for (const [k, n] of [...kinds.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k.padEnd(12)} ${n.toLocaleString()} (${((n / total) * 100).toFixed(2)}%)`);
  }

  console.log('\n━━ Primer y último attempt de properati (7d) ━━');
  const { data: first } = await sb
    .from('scrape_attempts')
    .select('created_at, error_kind, status_code')
    .eq('portal', 'properati')
    .gte('created_at', since7d)
    .order('created_at', { ascending: true })
    .limit(1);
  const { data: last } = await sb
    .from('scrape_attempts')
    .select('created_at, error_kind, status_code')
    .eq('portal', 'properati')
    .order('created_at', { ascending: false })
    .limit(1);
  console.log('  primer (7d):', first?.[0]);
  console.log('  último   :', last?.[0]);
}

main().catch(console.error);
