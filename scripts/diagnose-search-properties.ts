// Llama a searchProperties igual que el dashboard, pero con anon key
// (browser-like). Si devuelve 0, el bug está aquí.
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function main() {
  const { searchProperties } = await import('../lib/supabase');

  console.log('Test 1: searchProperties({}) — el call exacto del useEffect mount');
  const r1 = await searchProperties({});
  console.log(`  → ${r1.properties.length} props (count: ${r1.count})`);
  if (r1.properties.length > 0) {
    console.log(`  Sample: ${r1.properties[0].title?.slice(0, 60)}`);
  }

  console.log('\nTest 2: searchProperties({ limit: 20, offset: 0 }) — exacto useProperties');
  const r2 = await searchProperties({ limit: 20, offset: 0 });
  console.log(`  → ${r2.properties.length} props`);

  console.log('\nTest 3: con un filtro estructurado (city)');
  const r3 = await searchProperties({ city: 'Bogotá', limit: 20 });
  console.log(`  → ${r3.properties.length} props`);

  console.log('\nTest 4: con searchQuery vacío explícito ("")');
  const r4 = await searchProperties({ query: '', limit: 20 });
  console.log(`  → ${r4.properties.length} props (¿filtra por title="" ?)`);

  console.log('\nTest 5: simulando el handler {filters={}, query=undefined}');
  const filtersFromHook = {};
  const searchQueryFromState = '';
  const r5 = await searchProperties({
    ...filtersFromHook,
    query: searchQueryFromState || undefined,
    limit: 20,
    offset: 0,
  });
  console.log(`  → ${r5.properties.length} props`);
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
