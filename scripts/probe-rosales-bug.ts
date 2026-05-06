import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });

async function main() {
  const { findAlternativeZones } = await import('../lib/ai/zone-alternatives');

  console.log('\n── Bug repro: AI sin min_price (lo que probablemente pasa) ──');
  const r1 = await findAlternativeZones({
    city: 'Bogotá',
    original_neighborhood: 'Rosales',
    property_type: 'apartamento',
    listing_type: 'arriendo',
    max_price: 14_000_000,
  });
  for (const a of r1.alternatives) {
    console.log(
      `  ${a.neighborhood}: count=${a.count}, range=$${(a.min_price_cop ?? 0).toLocaleString('es-CO')} - $${(a.max_price_cop ?? 0).toLocaleString('es-CO')}`
    );
  }

  console.log('\n── Comparación: con rango razonable (12M-16M) ──');
  const r2 = await findAlternativeZones({
    city: 'Bogotá',
    original_neighborhood: 'Rosales',
    property_type: 'apartamento',
    listing_type: 'arriendo',
    min_price: 12_000_000,
    max_price: 16_000_000,
  });
  for (const a of r2.alternatives) {
    console.log(
      `  ${a.neighborhood}: count=${a.count}, range=$${(a.min_price_cop ?? 0).toLocaleString('es-CO')} - $${(a.max_price_cop ?? 0).toLocaleString('es-CO')}`
    );
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
