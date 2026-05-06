// scripts/smoke-rosales-fix.ts
// Verifica que el caso "Rosales" → "Los Rosales" ahora funciona.
// 2 niveles:
//   1. Helper resolveNeighborhood directo (sin Claude)
//   2. searchProperties end-to-end (sin Claude, vía la tool wrapper)

import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });

async function main() {
  const { resolveNeighborhood } = await import('../lib/ai/neighborhood-normalization');
  const { searchProperties } = await import('../lib/supabase');

  let pass = 0;
  let fail = 0;
  const check = (label: string, ok: boolean) => {
    console.log(`${ok ? '✅' : '❌'} ${label}`);
    ok ? pass++ : fail++;
  };

  // ── 1. resolveNeighborhood ──
  console.log('\n🔍 Test 1 — resolveNeighborhood\n');

  const cases: Array<{
    input: string;
    expected: string | null;
    why: string;
  }> = [
    { input: 'Rosales', expected: 'Los Rosales', why: 'caso reportado por user' },
    { input: 'rosales', expected: 'Los Rosales', why: 'lowercase' },
    { input: 'ROSALES', expected: 'Los Rosales', why: 'uppercase' },
    { input: 'Los Rosales', expected: 'Los Rosales', why: 'identidad' },
    { input: 'Chico', expected: 'El Chicó', why: 'sin tilde y sin artículo' },
  ];

  for (const tc of cases) {
    const r = await resolveNeighborhood('Bogotá', tc.input);
    const ok = r.canonical === tc.expected;
    check(
      `"${tc.input}" → "${r.canonical}" (esperado: "${tc.expected}", source: ${r.source}) — ${tc.why}`,
      ok
    );
  }

  // ── 2. searchProperties end-to-end ──
  console.log('\n🔍 Test 2 — searchProperties con "Rosales" (case real del user)\n');

  const r2 = await searchProperties({
    city: 'Bogotá',
    neighborhood: 'Los Rosales', // resolvedNeighborhood del helper
    listing_type: 'arriendo',
    property_type: 'apartamento',
    min_bedrooms: 2,
    max_bedrooms: 2,
    min_price: 11_900_000,
    max_price: 16_100_000,
    limit: 5,
  });
  console.log(`  Resultados: ${r2.properties.length} (count exacto: ${r2.count})`);
  for (const p of r2.properties) {
    console.log(
      `    $${p.price_cop.toLocaleString('es-CO').padStart(14)} · ${p.bedrooms ?? '?'}h · ${p.area_m2 ?? '?'}m² · ${p.source_portal} · "${p.neighborhood}"`
    );
  }
  check(
    'Encuentra el listing $12M de MetroCuadrado en Los Rosales',
    r2.properties.some(
      (p) =>
        p.price_cop === 12_000_000 &&
        p.bedrooms === 2 &&
        p.source_portal === 'metrocuadrado' &&
        (p.neighborhood ?? '').toLowerCase().includes('rosales')
    )
  );

  console.log(`\n──── Resultado: ${pass}/${pass + fail} pasaron ────\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('❌', e);
  process.exit(1);
});
