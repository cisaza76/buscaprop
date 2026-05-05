// scripts/smoke-history.ts
// Inserta snapshots sintéticos en property_history (90 días, 2 bajadas de
// precio) y valida que getPriceHistory los reconstruye correctamente.
// Cleanup automático al final.

import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });

async function main() {
  const { createClient } = await import('@supabase/supabase-js');
  const { getPriceHistory } = await import('../lib/ai/analytics');

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  // Tomar una propiedad real para tener un id válido (FK).
  const { data: prop } = await sb
    .from('properties')
    .select('id, price_cop, source_portal')
    .limit(1)
    .maybeSingle();
  if (!prop) {
    console.log('❌ No hay properties en DB para hacer smoke. Salir.');
    process.exit(1);
  }
  console.log(`Usando property: ${prop.id} (precio actual $${prop.price_cop.toLocaleString('es-CO')})`);

  // Limpiar snapshots previos de esta property (idempotencia del smoke).
  await sb.from('property_history').delete().eq('property_id', prop.id);

  // Insertar 5 snapshots sintéticos:
  //   D-90: $500M (inicial)
  //   D-60: $500M (sin cambio — nuestro código real NO insertaría este,
  //              pero simulamos un cambio de precio igual)  → de hecho lo
  //              omitimos (real-world no se insertaría).
  //   D-45: $480M (bajó $20M)
  //   D-20: $470M (bajó $10M)
  //   D-2:  $470M (último; sin cambio respecto al anterior — tampoco lo
  //              insertaríamos en producción, pero queremos que el último
  //              snapshot sea reciente, así que igual lo metemos)
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const fixtures = [
    { offsetDays: 90, price: 500_000_000, prev: null },
    { offsetDays: 45, price: 480_000_000, prev: 500_000_000 },
    { offsetDays: 20, price: 470_000_000, prev: 480_000_000 },
    { offsetDays: 2, price: 470_000_000, prev: 470_000_000 },
  ];

  for (const f of fixtures) {
    const scrapedAt = new Date(now - f.offsetDays * dayMs).toISOString();
    const deltaCop = f.prev !== null ? f.price - f.prev : null;
    const deltaPct =
      f.prev !== null && f.prev > 0 ? Math.round(((f.price - f.prev) / f.prev) * 10000) / 100 : null;
    const { error } = await sb.from('property_history').insert({
      property_id: prop.id,
      price_cop: f.price,
      scraped_at: scrapedAt,
      source_portal: prop.source_portal,
      status: 'active',
      delta_cop: deltaCop,
      delta_pct: deltaPct,
    });
    if (error) {
      console.log(`❌ insert fixture failed: ${error.message}`);
      if (/does not exist/i.test(error.message) || /could not find.*table/i.test(error.message)) {
        console.log('\n⚠️  Aplicá la migration 008 en Supabase SQL editor primero.');
      }
      process.exit(1);
    }
  }
  console.log(`✅ ${fixtures.length} snapshots insertados`);

  // Probar getPriceHistory.
  const result = await getPriceHistory({ property_id: prop.id, days: 90 });
  console.log('\n──── Resultado getPriceHistory ────');
  console.log(`first_seen_at: ${result.first_seen_at}`);
  console.log(`last_seen_at: ${result.last_seen_at}`);
  console.log(`days_on_market: ${result.days_on_market}`);
  console.log(`initial_price_cop: $${result.initial_price_cop?.toLocaleString('es-CO')}`);
  console.log(`current_price_cop: $${result.current_price_cop?.toLocaleString('es-CO')}`);
  console.log(`total_delta_cop: $${result.total_delta_cop?.toLocaleString('es-CO')}`);
  console.log(`total_delta_pct: ${result.total_delta_pct}%`);
  console.log(`price_changes_count: ${result.price_changes_count}`);
  console.log(`price_drops: ${result.price_drops.length}`);
  for (const d of result.price_drops) {
    console.log(
      `  - $${d.from_price_cop.toLocaleString('es-CO')} → $${d.to_price_cop.toLocaleString(
        'es-CO'
      )} (${d.delta_pct}%) el ${d.dropped_at.slice(0, 10)}`
    );
  }

  // Verificaciones.
  console.log('\n──── Verificaciones ────');
  let pass = 0,
    fail = 0;

  const checks: Array<[string, boolean]> = [
    ['initial_price_cop = $500M', result.initial_price_cop === 500_000_000],
    ['current_price_cop = $470M', result.current_price_cop === 470_000_000],
    ['total_delta_cop = -$30M', result.total_delta_cop === -30_000_000],
    ['days_on_market ~ 90', Math.abs((result.days_on_market ?? 0) - 90) <= 1],
    ['price_changes_count = 2', result.price_changes_count === 2],
    ['price_drops.length = 2', result.price_drops.length === 2],
    ['price_increases.length = 0', result.price_increases.length === 0],
    ['delisted_at is null', result.delisted_at === null],
  ];

  for (const [label, ok] of checks) {
    console.log(`${ok ? '✅' : '❌'} ${label}`);
    ok ? pass++ : fail++;
  }

  // Cleanup.
  await sb.from('property_history').delete().eq('property_id', prop.id);
  console.log('\n✅ cleanup OK');

  console.log(`\n──── Resultado: ${pass}/${pass + fail} pasaron ────`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
