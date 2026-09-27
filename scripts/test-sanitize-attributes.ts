// scripts/test-sanitize-attributes.ts
// Test unitario de sanitizeAttributes (lib/scrapers/shared/normalize.ts).
// Función pura — no toca red ni Supabase.
//
// Regresión que cubre (auditoría 2026-09-27): apartamentos de 0-5 m² y casas
// de 35 habitaciones entraban tal cual y contaminaban filtros y precio/m².

import { sanitizeAttributes } from '../lib/scrapers/shared/normalize';

let failures = 0;
function eq(name: string, got: unknown, want: unknown) {
  if (got === want) console.log(`  ✅ ${name}`);
  else {
    console.log(`  ❌ ${name} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    failures++;
  }
}

console.log('SANITIZE ATTRIBUTES TEST');
eq('apto de 1 m² → null', sanitizeAttributes({ property_type: 'apartamento', area_m2: 1 }).area_m2, null);
eq('casa de 5 m² → null', sanitizeAttributes({ property_type: 'casa', area_m2: 5 }).area_m2, null);
eq('apto de 40 m² se conserva', sanitizeAttributes({ property_type: 'apartamento', area_m2: 40 }).area_m2, 40);
eq('local/oficina de 8 m² se conserva', sanitizeAttributes({ property_type: 'oficina', area_m2: 8 }).area_m2, 8);
eq('lote de 0 m² → null', sanitizeAttributes({ property_type: 'lote', area_m2: 0 }).area_m2, null);
eq('35 habitaciones → null', sanitizeAttributes({ property_type: 'casa', bedrooms: 35 }).bedrooms, null);
eq('14 habitaciones se conservan', sanitizeAttributes({ property_type: 'casa', bedrooms: 14 }).bedrooms, 14);
eq('142 "habitaciones" en oficina → null', sanitizeAttributes({ property_type: 'oficina', bedrooms: 142 }).bedrooms, null);
eq('baños undefined → null', sanitizeAttributes({ property_type: 'casa' }).bathrooms, null);

if (failures > 0) {
  console.log(`\n❌ ${failures} fallo(s)`);
  process.exit(1);
}
console.log('\n✅ sanitize attributes OK');
