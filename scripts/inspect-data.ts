import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
import { createClient } from '@supabase/supabase-js';

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const { count: total } = await supabase
    .from('properties')
    .select('*', { count: 'exact', head: true });
  console.log(`Total propiedades en BD: ${total}`);

  const { count: fr } = await supabase
    .from('properties')
    .select('*', { count: 'exact', head: true })
    .eq('source_portal', 'fincaraiz');
  console.log(`De Fincaraíz: ${fr}`);

  // Muestra de 5 fincaraiz
  const { data: samples } = await supabase
    .from('properties')
    .select('title, city, neighborhood, price_cop, bedrooms, bathrooms, area_m2, property_type, listing_type')
    .eq('source_portal', 'fincaraiz')
    .order('created_at', { ascending: false })
    .limit(5);
  console.log('\nPrimeras 5 propiedades scrapeadas:');
  for (const p of samples ?? []) {
    const price = p.price_cop?.toLocaleString('es-CO');
    console.log(`  - ${p.title?.slice(0,60)}`);
    console.log(`    ${p.city}/${p.neighborhood ?? '?'} · ${p.property_type} ${p.listing_type} · $${price} · ${p.bedrooms ?? '?'}h/${p.bathrooms ?? '?'}b/${p.area_m2 ?? '?'}m²`);
  }

  // Distribución por ciudad y tipo
  const { data: byCity } = await supabase
    .from('properties')
    .select('city')
    .eq('source_portal', 'fincaraiz');
  const cityCount: Record<string, number> = {};
  for (const r of byCity ?? []) cityCount[r.city] = (cityCount[r.city] ?? 0) + 1;
  console.log('\nDistribución por ciudad (Fincaraíz):');
  for (const [city, n] of Object.entries(cityCount).sort((a,b) => b[1]-a[1])) {
    console.log(`  ${city}: ${n}`);
  }

  // Cuántas tienen lat/lng
  const { count: withGeo } = await supabase
    .from('properties')
    .select('*', { count: 'exact', head: true })
    .eq('source_portal', 'fincaraiz')
    .not('latitude', 'is', null);
  console.log(`\nCon geo: ${withGeo}/${fr}`);

  // Cuántas tienen precio
  const { count: withPrice } = await supabase
    .from('properties')
    .select('*', { count: 'exact', head: true })
    .eq('source_portal', 'fincaraiz')
    .gt('price_cop', 0);
  console.log(`Con precio: ${withPrice}/${fr}`);
}
main();
