// scripts/diagnose-rosales.ts
// Diagnóstico de causa raíz: por qué el sistema dice "no hay en Rosales"
// cuando MetroCuadrado claramente tiene listings allí.

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

  console.log('\n🔍 Diagnóstico — listings de Rosales en BD\n');

  // 1. ¿Cuántas variantes del nombre "Rosales" hay en BD?
  console.log('── 1. Distintas variantes del nombre del barrio ──');
  const { data: variants } = await sb
    .from('properties')
    .select('neighborhood')
    .ilike('neighborhood', '%rosales%')
    .eq('city', 'Bogotá');
  const counts = new Map<string, number>();
  for (const r of variants ?? []) {
    if (!r.neighborhood) continue;
    counts.set(r.neighborhood, (counts.get(r.neighborhood) ?? 0) + 1);
  }
  for (const [name, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  "${name}" → ${n} listings`);
  }
  console.log(`  TOTAL: ${variants?.length ?? 0} listings con 'rosales' en el name\n`);

  // 2. ¿Cuántos hay con eq exacto 'Rosales' (capitalización exacta)?
  console.log('── 2. eq("Rosales") — case-sensitive como mi searchProperties ──');
  const { data: exact, count: exactCount } = await sb
    .from('properties')
    .select('*', { count: 'exact', head: true })
    .eq('neighborhood', 'Rosales')
    .eq('city', 'Bogotá');
  console.log(`  Resultados: ${exactCount}\n`);

  // 3. ¿Y con ILIKE case-insensitive?
  console.log('── 3. ILIKE "rosales" — case-insensitive ──');
  const { count: ilikeCount } = await sb
    .from('properties')
    .select('*', { count: 'exact', head: true })
    .ilike('neighborhood', 'rosales')
    .eq('city', 'Bogotá');
  console.log(`  Resultados: ${ilikeCount}\n`);

  // 4. Listings de arriendo en Rosales ordenados por precio.
  console.log('── 4. Arriendo en Rosales (todos, ordenados por precio) ──');
  const { data: listings } = await sb
    .from('properties')
    .select(
      'id, neighborhood, price_cop, bedrooms, bathrooms, area_m2, source_portal, source_url'
    )
    .ilike('neighborhood', '%rosales%')
    .eq('city', 'Bogotá')
    .eq('listing_type', 'arriendo')
    .eq('is_duplicate', false)
    .order('price_cop', { ascending: true });
  for (const l of listings ?? []) {
    console.log(
      `  $${l.price_cop.toLocaleString('es-CO').padStart(14)} · ${l.bedrooms ?? '?'}h · ${l.area_m2 ?? '?'}m² · ${l.source_portal.padEnd(13)} · "${l.neighborhood}"`
    );
  }
  console.log(`  TOTAL arriendo: ${listings?.length ?? 0}\n`);

  // 5. Específicamente: arriendo 2 cuartos en Rosales.
  console.log('── 5. Arriendo + 2 cuartos exactos en Rosales (ILIKE) ──');
  const { data: l2 } = await sb
    .from('properties')
    .select('id, neighborhood, price_cop, bedrooms, area_m2, source_portal, source_url')
    .ilike('neighborhood', '%rosales%')
    .eq('city', 'Bogotá')
    .eq('listing_type', 'arriendo')
    .eq('is_duplicate', false)
    .gte('bedrooms', 2)
    .lte('bedrooms', 2)
    .order('price_cop', { ascending: true });
  for (const l of l2 ?? []) {
    console.log(
      `  $${l.price_cop.toLocaleString('es-CO').padStart(14)} · 2h · ${l.area_m2 ?? '?'}m² · ${l.source_portal.padEnd(13)} · "${l.neighborhood}"`
    );
  }
  console.log(`  TOTAL: ${l2?.length ?? 0}\n`);

  // 6. Mismo + filtro $14M ±15% (lo que aplicó mi sistema).
  console.log('── 6. Con filtro $11.9M-$16.1M (±15% de $14M) ──');
  const { count: c6 } = await sb
    .from('properties')
    .select('*', { count: 'exact', head: true })
    .ilike('neighborhood', '%rosales%')
    .eq('city', 'Bogotá')
    .eq('listing_type', 'arriendo')
    .eq('is_duplicate', false)
    .gte('bedrooms', 2)
    .lte('bedrooms', 2)
    .gte('price_cop', 11_900_000)
    .lte('price_cop', 16_100_000);
  console.log(`  Resultados: ${c6}\n`);

  console.log('\n──── Conclusión ────');
  if ((exactCount ?? 0) === 0 && (ilikeCount ?? 0) > 0) {
    console.log('🚨 BUG DE NORMALIZACIÓN: eq("Rosales") devuelve 0, pero ILIKE sí encuentra.');
    console.log('   La BD tiene el name con otra capitalización/variante.');
  } else if ((c6 ?? 0) === 0 && (l2?.length ?? 0) > 0) {
    console.log('🚨 BUG DE RANGO: con 2 cuartos hay listings en Rosales, pero el rango ±15%');
    console.log('   los excluye. La AI debe expandir rango cuando 0 resultados.');
  } else {
    console.log('Sin bug obvio. Posiblemente cobertura del scraper.');
  }
}

main().catch((e) => {
  console.error('❌', e);
  process.exit(1);
});
