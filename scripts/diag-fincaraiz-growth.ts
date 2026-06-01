import './_load-env';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const since10 = new Date(Date.now() - 10 * 86400000).toISOString();
  const since7 = new Date(Date.now() - 7 * 86400000).toISOString();

  console.log('\n━━ Comparación: properties.created_at por día por portal (últimos 10d) ━━');
  const byPortalDay = new Map<string, Map<string, number>>();
  for (const portal of ['fincaraiz', 'ciencuadras', 'metrocuadrado', 'properati']) {
    const m = new Map<string, number>();
    let from = 0; const pageSize = 1000;
    while (true) {
      const { data, error } = await sb
        .from('properties')
        .select('created_at')
        .eq('source_portal', portal)
        .gte('created_at', since10)
        .order('created_at', { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) { console.error(portal, error); break; }
      if (!data || data.length === 0) break;
      for (const r of data) {
        const d = r.created_at.substring(0, 10);
        m.set(d, (m.get(d) || 0) + 1);
      }
      if (data.length < pageSize) break;
      from += pageSize;
    }
    byPortalDay.set(portal, m);
  }
  const allDays = new Set<string>();
  for (const m of byPortalDay.values()) for (const d of m.keys()) allDays.add(d);
  const sortedDays = [...allDays].sort();
  const portals = ['fincaraiz', 'ciencuadras', 'metrocuadrado', 'properati'];
  console.log('  date         ' + portals.map(p => p.padStart(12)).join(' '));
  for (const d of sortedDays) {
    const row = portals.map(p => (byPortalDay.get(p)?.get(d) || 0).toLocaleString().padStart(12)).join(' ');
    console.log(`  ${d}  ${row}`);
  }
  const totals = portals.map(p => {
    let s = 0; for (const v of byPortalDay.get(p)?.values() || []) s += v; return s;
  });
  console.log('  TOTAL 10d   ' + totals.map(t => t.toLocaleString().padStart(12)).join(' '));

  console.log('\n━━ scrape_attempts fincaraiz (últimos 7d) ━━');
  // batch en paginas porque puede ser grande
  let from = 0; const pageSize = 1000;
  const totalsByKind = new Map<string, number>();
  const byDayAtt = new Map<string, number>();
  let totalAtt = 0;
  while (true) {
    const { data, error } = await sb
      .from('scrape_attempts')
      .select('error_kind, created_at')
      .eq('portal', 'fincaraiz')
      .gte('created_at', since7)
      .range(from, from + pageSize - 1);
    if (error) { console.error(error); break; }
    if (!data || data.length === 0) break;
    for (const a of data) {
      totalsByKind.set(a.error_kind, (totalsByKind.get(a.error_kind) || 0) + 1);
      const d = a.created_at.substring(0, 10);
      byDayAtt.set(d, (byDayAtt.get(d) || 0) + 1);
      totalAtt++;
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }
  console.log(`  Total attempts: ${totalAtt.toLocaleString()}`);
  console.log('  Por error_kind:');
  for (const [k, n] of [...totalsByKind.entries()].sort((a, b) => b[1] - a[1])) {
    const pct = ((n / totalAtt) * 100).toFixed(2);
    console.log(`    ${k.padEnd(12)} ${n.toLocaleString().padStart(8)}  (${pct}%)`);
  }
  console.log('  Por día:');
  for (const [d, n] of [...byDayAtt.entries()].sort()) console.log(`    ${d}  ${n.toLocaleString()}`);

  console.log('\n━━ Cursor state fincaraiz ━━');
  const { data: cursor, error: ce } = await sb
    .from('scraper_cursor')
    .select('*')
    .eq('portal', 'fincaraiz')
    .single();
  if (ce) console.error('cursor err:', ce);
  console.log(cursor);

  console.log('\n━━ Update_at por día por portal (últimos 10d, count exacto) ━━');
  // Conteo exacto por portal en la ventana usando count
  for (const portal of ['fincaraiz', 'ciencuadras', 'metrocuadrado', 'properati']) {
    const { count } = await sb
      .from('properties')
      .select('*', { count: 'exact', head: true })
      .eq('source_portal', portal)
      .gte('created_at', since10);
    console.log(`  ${portal.padEnd(15)} ${(count || 0).toLocaleString()} nuevas (10d)`);
  }
}

main().catch(console.error);
