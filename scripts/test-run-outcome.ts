// scripts/test-run-outcome.ts
// Test unitario del veredicto de corrida (failedRuns / dominantError). NO toca
// red ni Supabase — opera sobre funciones puras con ScrapeResult sintéticos.
//
// Regresión que cubre (incidente Properati, 26-ago-2026): el portal devolvió
// HTTP 401 en 2.080 fetches, escribió 0 filas y el job de CI salió verde 6 días
// seguidos. La corrida tiene que quedar marcada como fallo, y la etiqueta tiene
// que decir "HTTP 401" para no obligar a leer los logs del runner.

import { dominantError, failedRuns } from '../lib/scrapers/shared/run-outcome';
import type { ScrapeError, ScrapeResult, SourcePortal } from '../lib/scrapers/shared/types';

let failures = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
    failures++;
  }
}

function run(portal: SourcePortal, upserted: number, errors: ScrapeError[]): ScrapeResult {
  return {
    portal,
    startedAt: '2026-09-01T11:08:00.000Z',
    finishedAt: '2026-09-01T12:02:00.000Z',
    durationMs: 3_240_000,
    discovered: 0,
    fetched: 0,
    parsed: 0,
    upserted,
    duplicates: 0,
    errors,
  };
}

const err = (message: string, stage: ScrapeError['stage'] = 'fetch'): ScrapeError => ({
  url: 'https://www.properati.com.co/s/bogota-d-c-colombia/apartamento/venta',
  stage,
  message,
});

console.log('='.repeat(60));
console.log('TEST: veredicto de corrida (run-outcome)');
console.log('='.repeat(60));

console.log('\n1. failedRuns — cero filas + errores = fallo');
{
  const properati = run('properati', 0, Array.from({ length: 2080 }, () => err('HTTP 401 on url')));
  const sano = run('ciencuadras', 35, []);
  const failed = failedRuns([properati, sano]);
  ok('el portal bloqueado se marca como fallido', failed.length === 1);
  ok('y es properati, no el sano', failed[0]?.portal === 'properati');
}

console.log('\n2. Los casos legítimos NO se marcan');
{
  // Tick tranquilo: portal ya drenado, nada nuevo que escribir y nada roto.
  ok('0 upserted + 0 errores → verde', failedRuns([run('fincaraiz', 0, [])]).length === 0);
  // Corrida productiva con ruido: unos listings borrados no invalidan 35 filas.
  ok(
    'upserted > 0 con algunos errores → verde',
    failedRuns([run('fincaraiz', 35, [err('HTTP 404 on url')])]).length === 0
  );
  ok('sin corridas → sin fallos', failedRuns([]).length === 0);
}

console.log('\n3. dominantError — etiqueta accionable');
{
  const mixtos = [
    ...Array.from({ length: 10 }, () => err('HTTP 401 on url')),
    ...Array.from({ length: 3 }, () => err('HTTP 404 on url')),
  ];
  const label = dominantError(mixtos);
  ok('reporta el código mayoritario', label.includes('HTTP 401'), label);
  ok('con su proporción', label.includes('(10/13)'), label);
  ok(
    'sin código HTTP cae a etapa + mensaje',
    dominantError([err('fetch failed', 'discovery')]).includes('discovery'),
    dominantError([err('fetch failed', 'discovery')])
  );
  ok('lista vacía no explota', dominantError([]) === 'sin errores');
}

console.log('\n' + '='.repeat(60));
if (failures > 0) {
  console.log(`❌ ${failures} aserción(es) fallaron`);
  process.exit(1);
}
console.log('✅ TODOS LOS TESTS PASARON');
