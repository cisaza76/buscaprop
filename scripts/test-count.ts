import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
async function main() {
  const { searchProperties } = await import('../lib/supabase');
  const r = await searchProperties({ city: 'Bogotá', neighborhood: 'Chapinero', limit: 20 });
  console.log(`Bogotá+Chapinero p.1: ${r.properties.length} props · TOTAL: ${r.count}`);
  const r2 = await searchProperties({ city: 'Bogotá', neighborhood: 'Chapinero', limit: 20, offset: 20 });
  console.log(`Bogotá+Chapinero p.2: ${r2.properties.length} props · TOTAL: ${r2.count}`);
  const r3 = await searchProperties({ city: 'Bogotá', neighborhood: 'Chapinero', limit: 20, offset: 60 });
  console.log(`Bogotá+Chapinero p.4: ${r3.properties.length} props · TOTAL: ${r3.count}`);
}
main();
