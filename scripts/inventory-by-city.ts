// scripts/inventory-by-city.ts
// Distribución de inventario por ciudad — útil para detectar si la cobertura
// está concentrada en Bogotá o si hay representación nacional.
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
config({ path: '.env.local' });

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  // Pull all properties with city, count en JS.
  const all: Array<{ city: string | null; listing_type: string | null }> = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data: page, error: pageErr } = await sb
      .from('properties')
      .select('city, listing_type')
      .eq('is_duplicate', false)
      .range(from, from + PAGE - 1);
    if (pageErr) { console.error(pageErr); process.exit(1); }
    if (!page || page.length === 0) break;
    all.push(...(page as typeof all));
    if (page.length < PAGE) break;
    from += PAGE;
  }

  const byCity = new Map<string, { rent: number; sale: number; total: number }>();
  for (const p of all) {
    const city = p.city ?? '(sin ciudad)';
    const e = byCity.get(city) ?? { rent: 0, sale: 0, total: 0 };
    e.total++;
    if (p.listing_type === 'rent') e.rent++;
    if (p.listing_type === 'sale') e.sale++;
    byCity.set(city, e);
  }
  const rows = [...byCity.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 15)
    .map(([city, c]) => ({ city, total: c.total, rent: c.rent, sale: c.sale }));
  console.log(`Total únicos: ${all.length.toLocaleString('es-CO')}`);
  console.table(rows);
}
main();
