// scripts/smoke-ideca.ts
// Test el helper queryIDECAByCoords con 3 puntos:
//   1. Bogotá Chapinero (point real → debe devolver verified + datos coherentes)
//   2. Buenos Aires (afuera → debe devolver not_found)
//   3. Medio del océano (afuera → not_found)

import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });

interface TestCase {
  label: string;
  lat: number;
  lng: number;
  expect: 'verified' | 'not_found';
}

const CASES: TestCase[] = [
  { label: 'Bogotá Chapinero (real)', lat: 4.6991509, lng: -74.0518031, expect: 'verified' },
  { label: 'Bogotá El Chicó (real)', lat: 4.678102, lng: -74.0410069, expect: 'verified' },
  { label: 'Buenos Aires (fuera)', lat: -34.6037, lng: -58.3816, expect: 'not_found' },
];

async function main() {
  const { queryIDECAByCoords, soilClassificationLabel } = await import('../lib/cadastre/ideca');

  console.log(`\n🧪 Smoke IDECA — ${CASES.length} puntos\n`);

  let pass = 0;
  let fail = 0;

  for (const tc of CASES) {
    const t0 = Date.now();
    const r = await queryIDECAByCoords(tc.lat, tc.lng);
    const ms = Date.now() - t0;
    const ok = r.status === tc.expect;
    const symbol = ok ? '✅' : '❌';
    console.log(`${symbol} ${tc.label.padEnd(30)} → status=${r.status} (${ms}ms)`);
    if (r.status === 'verified') {
      console.log(`     lot:    ${r.lot_code}`);
      console.log(`     manz:   ${r.manzana_code}`);
      console.log(`     sector: ${r.sector_code} · ${r.sector_name}`);
      console.log(`     área:   ${r.lot_area_m2} m²  (${r.predio_units} unidades)`);
      console.log(`     suelo:  ${soilClassificationLabel(r.soil_classification)}`);
    } else if (r.status === 'error') {
      console.log(`     error:  ${r.error_message}`);
    }
    ok ? pass++ : fail++;
  }

  console.log(`\n──── Resultado: ${pass}/${pass + fail} pasaron ────\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
