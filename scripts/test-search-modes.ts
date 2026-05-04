import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function main() {
  const { searchProperties } = await import('../lib/supabase');

  console.log('═══ Modo 1: Search box con texto libre ("chapinero") ═══');
  const t1 = await searchProperties({ query: 'chapinero', limit: 1000 });
  console.log(`  ILIKE %chapinero% en title → ${t1.properties.length} resultados`);
  console.log('  Primeros 5 títulos:');
  for (const p of t1.properties.slice(0, 5)) {
    console.log(`    · ${p.title?.slice(0, 70)} | ${p.city}/${p.neighborhood}`);
  }

  console.log('\n═══ Modo 2: Filtro estructurado (city=Bogotá, neighborhood=Chapinero) ═══');
  const t2 = await searchProperties({ city: 'Bogotá', neighborhood: 'Chapinero', limit: 1000 });
  console.log(`  eq city + eq neighborhood → ${t2.properties.length} resultados (esperado 70)`);

  console.log('\n═══ Modo 3: Combinado (texto "amoblado" + Bogotá + Chapinero) ═══');
  const t3 = await searchProperties({ query: 'amoblado', city: 'Bogotá', neighborhood: 'Chapinero', limit: 1000 });
  console.log(`  ILIKE + eq + eq → ${t3.properties.length} resultados`);
  for (const p of t3.properties.slice(0, 3)) {
    console.log(`    · ${p.title?.slice(0, 80)}`);
  }

  console.log('\n═══ Modo 4: Sin filtros (control) ═══');
  const t4 = await searchProperties({ limit: 5 });
  console.log(`  sin filtros → ${t4.properties.length} resultados (limit 5)`);
}
main();
