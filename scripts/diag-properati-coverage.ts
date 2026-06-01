// Auditoría de cobertura de Properati por listing_type / property_type.
//
// OJO con dos ceros que NO son bug (verificado 2026-05-30):
//   - apartaestudio: la enum PropertyType del schema no tiene 'apartaestudio';
//     mapPropertyType() lo pliega en 'apartamento' (normalize.ts). Por eso una
//     query por property_type='apartaestudio' SIEMPRE da 0 — los listings sí se
//     crawlean, pero cuentan como apartamento.
//   - lote: no está en el DEFAULT_TYPES del scraper de Properati (properati.ts),
//     así que nunca se crawlea. Cero esperado, no falta de cobertura.
// Solo 'apartamento' | 'casa' | 'oficina' | 'lote' son valores almacenables.
import './_load-env';
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function countBy(col: string, val: string, extra?: [string, string]) {
  let q = sb.from('properties').select('*', { count: 'exact', head: true })
    .eq('source_portal', 'properati').eq(col, val);
  if (extra) q = q.eq(extra[0], extra[1]);
  const { count } = await q;
  return count || 0;
}

async function main() {
  console.log('\n━━ Properati por listing_type ━━');
  for (const lt of ['venta', 'arriendo']) {
    console.log(`  ${lt.padEnd(10)} ${(await countBy('listing_type', lt)).toLocaleString()}`);
  }
  // Solo valores almacenables de la enum. apartaestudio→apartamento y lote
  // no se crawlea (ver cabecera), así que consultarlos solo confunde.
  console.log('\n━━ Properati por property_type ━━');
  for (const pt of ['apartamento', 'casa', 'oficina', 'lote']) {
    console.log(`  ${pt.padEnd(14)} ${(await countBy('property_type', pt)).toLocaleString()}`);
  }
  console.log('\n━━ Properati venta×arriendo por tipo ━━');
  for (const pt of ['apartamento', 'casa', 'oficina']) {
    const v = await countBy('property_type', pt, ['listing_type', 'venta']);
    const a = await countBy('property_type', pt, ['listing_type', 'arriendo']);
    console.log(`  ${pt.padEnd(14)} venta=${v.toLocaleString().padStart(6)}  arriendo=${a.toLocaleString().padStart(6)}`);
  }
}
main().catch(console.error);
