// scripts/test-zone-alternatives.ts
// Unit-test del helper findAlternativeZones contra DB real. Sin Claude.

import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });

async function main() {
  const { findAlternativeZones } = await import('../lib/ai/zone-alternatives');

  console.log('\n🧪 Test findAlternativeZones — DB real\n');

  const cases = [
    {
      label: 'Rosales arriendo $14-16M',
      input: {
        city: 'Bogotá',
        original_neighborhood: 'Rosales',
        property_type: 'apartamento' as const,
        listing_type: 'arriendo' as const,
        min_price: 14_000_000,
        max_price: 16_000_000,
      },
    },
    {
      label: 'El Chicó venta $800M-1.2B',
      input: {
        city: 'Bogotá',
        original_neighborhood: 'El Chicó',
        property_type: 'apartamento' as const,
        listing_type: 'venta' as const,
        min_price: 800_000_000,
        max_price: 1_200_000_000,
      },
    },
    {
      label: 'Barrio sin mapping',
      input: {
        city: 'Bogotá',
        original_neighborhood: 'Engativá',
        property_type: 'apartamento' as const,
        listing_type: 'venta' as const,
      },
    },
  ];

  for (const tc of cases) {
    console.log(`── ${tc.label} ──`);
    const t0 = Date.now();
    const r = await findAlternativeZones(tc.input);
    const ms = Date.now() - t0;
    console.log(`  ${ms}ms · original_count=${r.original_count}`);
    if (r.warning) console.log(`  ⚠️  ${r.warning}`);
    for (const a of r.alternatives) {
      console.log(
        `    ${a.neighborhood.padEnd(20)} count=${String(a.count).padStart(3)} · avg=$${(a.avg_price_cop ?? 0).toLocaleString('es-CO')}`
      );
      for (const sp of a.sample_properties.slice(0, 2)) {
        console.log(
          `      └ $${sp.price_cop.toLocaleString('es-CO')} · ${sp.bedrooms ?? '?'}h · ${sp.area_m2 ?? '?'}m² · ${sp.source_portal}`
        );
      }
    }
    console.log();
  }
}

main().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
