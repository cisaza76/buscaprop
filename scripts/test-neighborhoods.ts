import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function main() {
  // Dynamic import después de cargar env vars (lib/supabase.ts throw si faltan).
  const { fetchNeighborhoodsByCity, searchProperties } = await import('../lib/supabase');

  console.log('═══ fetchNeighborhoodsByCity("Bogotá") ═══');
  const hoods = await fetchNeighborhoodsByCity('Bogotá');
  console.log(`  total distinct: ${hoods.length}`);
  console.log(`  primeros 10: ${hoods.slice(0, 10).join(', ')}`);
  console.log(`  ¿incluye Chapinero?: ${hoods.includes('Chapinero')}`);

  console.log('\n═══ searchProperties({city: "Bogotá", neighborhood: "Chapinero"}) ═══');
  const { properties } = await searchProperties({ city: 'Bogotá', neighborhood: 'Chapinero', limit: 1000 });
  console.log(`  resultados: ${properties.length}`);
  console.log(`  Sample 3:`);
  for (const p of properties.slice(0, 3)) {
    console.log(`    - ${p.title?.slice(0,55)} | $${p.price_cop?.toLocaleString('es-CO')}`);
  }
}
main();
