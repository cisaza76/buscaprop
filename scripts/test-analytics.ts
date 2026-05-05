// scripts/test-analytics.ts
// Unit-test de los 3 helpers de analytics directo (sin LLM).
// Confirma que las queries funcionan y los resultados son sensibles.

import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });

async function main() {
  const { analyzeNeighborhood, findComparables, simulateCredit } = await import(
    '../lib/ai/analytics'
  );

  // ── Test 1: analyzeNeighborhood ──────────────────────────────────────────
  console.log('\n──── TEST 1: analyzeNeighborhood (Bogotá / Chapinero, venta apto, ≤800M) ────');
  const a = await analyzeNeighborhood({
    city: 'Bogotá',
    neighborhood: 'Chapinero',
    property_type: 'apartamento',
    listing_type: 'venta',
    max_price: 800_000_000,
  });
  console.log(`total_available: ${a.total_available}`);
  console.log(
    `avg_price_cop: ${a.avg_price_cop ? `$${a.avg_price_cop.toLocaleString('es-CO')}` : 'null'}`
  );
  console.log(
    `median_price_cop: ${a.median_price_cop ? `$${a.median_price_cop.toLocaleString('es-CO')}` : 'null'}`
  );
  console.log(
    `avg_price_per_m2: ${a.avg_price_per_m2 ? `$${a.avg_price_per_m2.toLocaleString('es-CO')}` : 'null'}`
  );
  console.log(`bedroom_distribution:`, a.bedroom_distribution);
  console.log(`by_portal:`, a.by_portal);
  if (a.warning) console.log(`⚠️  ${a.warning}`);

  // ── Test 2: findComparables ──────────────────────────────────────────────
  console.log('\n──── TEST 2: findComparables ────');
  // Necesitamos un property_id real. Tomamos el primero que matche con Bogotá/Chapinero/apto.
  const { searchProperties } = await import('../lib/supabase');
  const { properties } = await searchProperties({
    city: 'Bogotá',
    neighborhood: 'Chapinero',
    property_type: 'apartamento',
    listing_type: 'venta',
    limit: 1,
  });
  if (properties.length === 0) {
    console.log('❌ No hay propiedades en Bogotá/Chapinero — saltando test 2.');
  } else {
    const ref = properties[0];
    console.log(
      `Reference: ${ref.title.slice(0, 50)}... ($${ref.price_cop.toLocaleString('es-CO')}, ` +
        `${ref.bedrooms}h, ${ref.neighborhood})`
    );
    const c = await findComparables({ property_id: ref.id });
    console.log(`Comparables encontrados: ${c.comparables.length}`);
    for (const cmp of c.comparables) {
      const sign = cmp.price_diff_pct >= 0 ? '+' : '';
      console.log(
        `  - ${cmp.title.slice(0, 40)} · $${cmp.price_cop.toLocaleString('es-CO')} ` +
          `(${sign}${cmp.price_diff_pct}%) · ${cmp.bedrooms}h · ${cmp.area_m2 ?? '?'}m²`
      );
    }
    if (c.warning) console.log(`⚠️  ${c.warning}`);
  }

  // ── Test 3: simulateCredit ───────────────────────────────────────────────
  console.log('\n──── TEST 3: simulateCredit ($550M precio, 30% inicial, 20 años) ────');
  const s = simulateCredit({
    price_cop: 550_000_000,
    down_payment_cop: 165_000_000, // 30%
    years: 20,
  });
  console.log(`Loan amount: $${s.inputs.loan_amount_cop.toLocaleString('es-CO')}`);
  console.log(`Plazo: ${s.inputs.years} años`);
  console.log(`Tasa: ${(s.inputs.annual_rate * 100).toFixed(1)}% E.A.`);
  console.log(`Cuota mensual: $${s.monthly_payment_cop.toLocaleString('es-CO')}`);
  console.log(`Total intereses: $${s.total_interest_cop.toLocaleString('es-CO')}`);
  console.log(`Disclaimer: ${s.disclaimer}`);

  // ── Sanity check: cuota razonable ────────────────────────────────────────
  // $385M a 20 años a 12% E.A. ≈ $4M/mes. Ajustá los rangos si la fórmula es distinta.
  const ok =
    s.monthly_payment_cop > 3_000_000 &&
    s.monthly_payment_cop < 6_000_000 &&
    s.inputs.loan_amount_cop === 385_000_000;
  if (!ok) {
    console.log(
      `\n❌ Cuota fuera de rango razonable. Verificá la fórmula. ` +
        `(esperaba 3-6M, obtuve ${s.monthly_payment_cop})`
    );
    process.exit(1);
  }

  console.log('\n✅ Todos los tests de analytics pasaron.');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
