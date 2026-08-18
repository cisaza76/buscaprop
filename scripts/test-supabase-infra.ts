// scripts/test-supabase-infra.ts
// Regresión del incidente 2026-08-18: el secret NEXT_PUBLIC_SUPABASE_URL de
// GitHub Actions traía sufijo '/rest/v1/', así que supabase-js construía
// '…/rest/v1/rest/v1/properties' y PostgREST respondía PGRST125. Resultado:
// el cron de 6h llevaba semanas escribiendo 0 filas (1500 errores por portal
// por run) y la alerta lo reportaba como saludable.
//
// Dos defensas testeadas acá:
//   1. normalizeSupabaseUrl — una URL mal configurada no puede volver a
//      romper todas las llamadas.
//   2. isMissingColumnError — distinguir "la columna no existe" de un error
//      de transporte, para que un fallo de red no haga creer al upsert que
//      contact_phone no existe y descarte el dato en silencio.

import { normalizeSupabaseUrl } from '../lib/supabase-url';
import { isMissingColumnError } from '../lib/scrapers/shared/upsert';

console.log('='.repeat(60));
console.log('SUPABASE INFRA — REGRESIÓN PGRST125');
console.log('='.repeat(60));

let fails = 0;

console.log('\n━━ normalizeSupabaseUrl ━━');
const assertUrl = (raw: string, want: string) => {
  const got = normalizeSupabaseUrl(raw);
  const ok = got === want;
  console.log(`  ${ok ? '✅' : '❌'} ${JSON.stringify(raw).padEnd(42)} → ${got}`);
  if (!ok) {
    console.log(`      esperado: ${want}`);
    fails++;
  }
};
const BASE = 'https://abcdefgh.supabase.co';
assertUrl(BASE, BASE);                          // ya correcta, no la toca
assertUrl(`${BASE}/`, BASE);                    // slash final
assertUrl(`${BASE}//`, BASE);                   // slashes repetidos
assertUrl(`${BASE}/rest/v1`, BASE);             // el bug exacto, sin slash
assertUrl(`${BASE}/rest/v1/`, BASE);            // el bug exacto de producción
assertUrl(`  ${BASE}/rest/v1/  `, BASE);        // + whitespace al pegar el secret
assertUrl(`${BASE}/REST/V1/`, BASE);            // mayúsculas
assertUrl('http://localhost:54321/rest/v1', 'http://localhost:54321'); // supabase local
assertUrl(`${BASE}/auth/v1/`, BASE);            // otro sufijo de la consola

console.log('\n━━ isMissingColumnError ━━');
const assertMissing = (label: string, err: unknown, want: boolean) => {
  const got = isMissingColumnError(err);
  const ok = got === want;
  console.log(`  ${ok ? '✅' : '❌'} ${label.padEnd(52)} → ${got} (esperado ${want})`);
  if (!ok) fails++;
};
// Columna realmente ausente (migración sin aplicar): PostgREST devuelve 42703.
assertMissing(
  'columna inexistente (42703)',
  { code: '42703', message: 'column properties.contact_phone does not exist' },
  true
);
assertMissing(
  'schema cache sin la columna (PGRST204)',
  { code: 'PGRST204', message: "Could not find the 'foo' column of 'properties'" },
  true
);
// Errores que NO son columna ausente — tratarlos como tal fue lo que hizo
// que el upsert descartara contact_phone/dedup_hash en silencio.
assertMissing(
  'PGRST125 path inválido (el bug de producción)',
  { code: 'PGRST125', message: 'Invalid path specified in request URL' },
  false
);
assertMissing('fetch failed (red caída)', new TypeError('fetch failed'), false);
assertMissing('timeout', { message: 'upstream request timeout' }, false);
assertMissing('503 del gateway', { code: '503', message: 'Service Unavailable' }, false);
assertMissing('error nulo', null, false);

if (fails > 0) {
  console.log(`\n❌ ${fails} aserción(es) fallaron`);
  process.exit(1);
}
console.log('\n✅ TODOS LOS TESTS PASARON');
