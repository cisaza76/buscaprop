import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function main() {
  const { createClient } = await import('@supabase/supabase-js');

  // Step 3 (que pediste): SQL direct con service_role (bypass RLS)
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  console.log('═══ Step 3: SQL directo (service role, bypass RLS) ═══');
  const { count: c1 } = await sb.from('properties')
    .select('*', { count: 'exact', head: true })
    .eq('city', 'Bogotá')
    .eq('neighborhood', 'Chapinero')
    .eq('is_duplicate', false);
  console.log(`  city='Bogotá' AND neighborhood='Chapinero' AND is_duplicate=false → ${c1} props`);

  // Mismo query con anon key (lo que hace el browser)
  console.log('\n═══ Mismo query con ANON key (lo que hace el browser) ═══');
  const sbAnon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
  );
  const { count: c2 } = await sbAnon.from('properties')
    .select('*', { count: 'exact', head: true })
    .eq('city', 'Bogotá')
    .eq('neighborhood', 'Chapinero')
    .eq('is_duplicate', false);
  console.log(`  → ${c2} props`);

  // Llamar searchProperties — la función exacta del dashboard
  console.log('\n═══ searchProperties() exacto como lo llama useProperties ═══');
  const { searchProperties } = await import('../lib/supabase');
  const r = await searchProperties({
    city: 'Bogotá',
    neighborhood: 'Chapinero',
    limit: 20,
    offset: 0,
  });
  console.log(`  → ${r.properties.length} props`);
  if (r.properties.length > 0) {
    console.log(`  Sample:`);
    for (const p of r.properties.slice(0, 3)) {
      console.log(`    · ${p.title?.slice(0, 70)} | ${p.neighborhood}`);
    }
  }

  // Variantes que pueden estar fallando
  console.log('\n═══ Variantes posibles del valor seleccionado en UI ═══');
  for (const variant of ['Chapinero', 'CHAPINERO', 'chapinero', 'Chapinero ', ' Chapinero']) {
    const r = await searchProperties({ city: 'Bogotá', neighborhood: variant, limit: 1000 });
    console.log(`  city='Bogotá' + neighborhood='${variant}' → ${r.properties.length} props`);
  }

  // Verificar si el dropdown del UI carga "Chapinero" tal cual está en BD
  console.log('\n═══ Lista exacta de barrios para Bogotá (lo que carga useNeighborhoods) ═══');
  const { fetchNeighborhoodsByCity } = await import('../lib/supabase');
  const hoods = await fetchNeighborhoodsByCity('Bogotá');
  const matchesChapi = hoods.filter((h) => h.toLowerCase().includes('chapi'));
  console.log(`  total hoods: ${hoods.length}`);
  console.log(`  los que contienen 'chapi':`, matchesChapi);
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
