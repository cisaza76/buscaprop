// scripts/test-ciencuadras-activity.ts
// Test unitario del clasificador de actividad de Ciencuadras. NO toca red ni
// Supabase — opera sobre isCiencuadrasListingActive con blobs detail-state
// sintéticos, construidos con los casos REALES medidos el 2026-08-18 sobre una
// muestra estratificada de 40 fichas (5 ciudades × 4 tipos × 2 operaciones),
// de las cuales 16 no estaban activas.
//
// El caso que justifica todo esto: "Inmueble No Activo" llega con la ficha
// COMPLETA —precio, teléfono, todo—, así que parsea como item válido, se
// upsertea y refresca su scraped_at. El barrido de staleness, que dispara por
// antigüedad, nunca lo alcanza: se auto-refresca para siempre.

import { isCiencuadrasListingActive } from '../lib/scrapers/ciencuadras';

let failures = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
    failures++;
  }
}

/** Blob detail-state con la key dinámica que usa el portal. */
const state = (detail: unknown) => ({ 'detail-property-/inmueble/apartamento-en-venta-x-1234': detail });

const generalData = { whatsAppContact: '3001234567', advisoryName: 'Inmobiliaria X' };

console.log('='.repeat(60));
console.log('TEST: clasificador de actividad de Ciencuadras');
console.log('='.repeat(60));

console.log('\n1. Inmueble activo');
{
  ok('sin message → activo', isCiencuadrasListingActive(state({ generalData })));
  ok('message null → activo', isCiencuadrasListingActive(state({ message: null, generalData })));
  ok(
    'message informativo cualquiera → activo',
    isCiencuadrasListingActive(state({ message: 'OK', generalData }))
  );
}

console.log('\n2. Inmueble NO activo — el caso pernicioso');
{
  // Llega con generalData COMPLETO: parsea como item válido y se upsertea.
  ok(
    'StatusCode 1 → inactivo',
    !isCiencuadrasListingActive(state({ message: 'Inmueble No Activo. StatusCode: 1', generalData }))
  );
  ok(
    'StatusCode 2 → inactivo',
    !isCiencuadrasListingActive(state({ message: 'Inmueble No Activo. StatusCode: 2', generalData }))
  );
  // No distinguimos entre los dos códigos: ninguno está disponible.
  ok(
    'variación de mayúsculas/espaciado → inactivo',
    !isCiencuadrasListingActive(state({ message: 'inmueble  no   activo', generalData }))
  );
}

console.log('\n3. La trampa: `error: true` sale TAMBIÉN en fichas vivas');
{
  // Medido: viene de una sub-request lateral del portal. Mirar `error` en vez
  // de `message` marcaría como muertos inmuebles perfectamente buenos.
  ok(
    'error:true con ficha viva → SIGUE activo',
    isCiencuadrasListingActive(state({ error: true, generalData }))
  );
  ok(
    'error:true + message de inactivo → inactivo (manda message)',
    !isCiencuadrasListingActive(
      state({ error: true, message: 'Inmueble No Activo. StatusCode: 1', generalData })
    )
  );
  // Ficha borrada: sin generalData. El parser ya devuelve null antes de llegar
  // acá (no hay precio), así que cae al barrido de staleness — pero el
  // clasificador no debe inventarse un veredicto.
  ok(
    'ficha borrada ("Property Code without results") → no la juzga inactiva',
    isCiencuadrasListingActive(state({ error: true, message: 'Property Code without results' }))
  );
}

console.log('\n4. Falla hacia "activo" — esconder catálogo vivo es peor');
{
  ok('state null → activo', isCiencuadrasListingActive(null));
  ok('state vacío → activo', isCiencuadrasListingActive({}));
  ok('sin la key detail-property- → activo', isCiencuadrasListingActive({ otra: {} }));
  ok('detail no-objeto → activo', isCiencuadrasListingActive(state('basura')));
  ok('message no-string → activo', isCiencuadrasListingActive(state({ message: 42 })));
  ok('string suelto → activo', isCiencuadrasListingActive('no soy un blob'));
}

console.log('\n' + '='.repeat(60));
if (failures > 0) {
  console.log(`❌ ${failures} aserción(es) fallaron`);
  process.exit(1);
}
console.log('✅ TODOS LOS TESTS PASARON');
