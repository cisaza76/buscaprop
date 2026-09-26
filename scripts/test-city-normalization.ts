// scripts/test-city-normalization.ts
// Test unitario de la ciudad que sale del slug de Fincaraiz. NO toca red ni
// Supabase — parseFincaraizSlug + canonicalCity son funciones puras.
//
// Regresión que cubre (medido 2026-09-26): el chat filtra por `city` con
// igualdad exacta, y ~6.500 filas de Fincaraiz tenían la ciudad como slug
// ("El-retiro", "La-ceja", "La-estrella"): el user pedía "El Retiro" y veía 25
// de ~3.300 inmuebles. Otras 988 quedaron como city="Colombia" + barrio
// "Puerto" — eran de Puerto Colombia (Atlántico), partidas por la última palabra.

import { parseFincaraizSlug } from '../lib/scrapers/fincaraiz';
import { canonicalCity } from '../lib/scrapers/shared/normalize';

let failures = 0;
function eq(name: string, got: unknown, want: unknown) {
  if (got === want) console.log(`  ✅ ${name}`);
  else {
    console.log(`  ❌ ${name} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    failures++;
  }
}

function cityOf(url: string) {
  const s = parseFincaraizSlug(url);
  return { city: s ? canonicalCity(s.city) : null, hood: s?.neighborhood };
}

console.log('\n━━ canonicalCity: slugs con guion ━━');
eq('el-retiro', canonicalCity('el-retiro'), 'El Retiro');
eq('El-retiro (ya guardado así en BD)', canonicalCity('El-retiro'), 'El Retiro');
eq('la-ceja', canonicalCity('la-ceja'), 'La Ceja');
eq('la-estrella', canonicalCity('la-estrella'), 'La Estrella');
eq('el-penol conserva la tilde', canonicalCity('el-penol'), 'El Peñol');
eq('la-union conserva la tilde', canonicalCity('la-union'), 'La Unión');
eq('santa-barbara conserva la tilde', canonicalCity('santa-barbara'), 'Santa Bárbara');
eq('conector "de" en minúscula', canonicalCity('santa-rosa-de-osos'), 'Santa Rosa de Osos');
eq('fallback sin mapa: título por palabra', canonicalCity('la-cumbre'), 'La Cumbre');

console.log('\n━━ canonicalCity: no rompe lo que ya funcionaba ━━');
eq('bogota', canonicalCity('bogota'), 'Bogotá');
eq('Medellín', canonicalCity('Medellín'), 'Medellín');
eq('El Carmen de Viboral', canonicalCity('El Carmen de Viboral'), 'El Carmen de Viboral');
eq('viboral (slug partido)', canonicalCity('viboral'), 'El Carmen de Viboral');

console.log('\n━━ parseFincaraizSlug → Puerto Colombia ━━');
const pc = cityOf('https://www.fincaraiz.com.co/apartaestudio-en-arriendo-en-puerto-colombia/10625838');
eq('ciudad', pc.city, 'Puerto Colombia');
eq('sin barrio basura "Puerto"', pc.hood, undefined);
const pcHood = cityOf('https://www.fincaraiz.com.co/apartamento-en-arriendo-en-salgar-puerto-colombia/11099004');
eq('con barrio: ciudad', pcHood.city, 'Puerto Colombia');
eq('con barrio: barrio', pcHood.hood, 'salgar');
eq('el-retiro vía slug', cityOf('https://www.fincaraiz.com.co/casa-en-venta-en-el-retiro/123').city, 'El Retiro');

if (failures > 0) {
  console.log(`\n❌ ${failures} fallo(s)`);
  process.exit(1);
}
console.log('\n✅ city normalization OK');
