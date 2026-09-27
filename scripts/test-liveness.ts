// scripts/test-liveness.ts
// Test unitario del clasificador de disponibilidad (lib/scrapers/shared/liveness.ts).
// Función pura — no toca red.
//
// Regresión que cubre (2026-09-27): una búsqueda de arriendo en Rosales
// devolvió 20 propiedades y ~16 ya estaban retiradas del portal. Ninguno de
// los tres portales responde 404: Fincaraiz redirige a ?addeletedid=, y
// Metrocuadrado/Ciencuadras responden 200 con un aviso en la página.

import fs from 'node:fs';
import path from 'node:path';
import { classifyListingPage } from '../lib/scrapers/shared/liveness';

let failures = 0;
function eq(name: string, got: unknown, want: unknown) {
  if (got === want) console.log(`  ✅ ${name}`);
  else {
    console.log(`  ❌ ${name} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    failures++;
  }
}

const FR = 'https://www.fincaraiz.com.co/apartamento-en-arriendo-en-los-rosales-bogota/193897133';
const M2 = 'https://www.metrocuadrado.com/inmueble/arriendo-apartamento-bogota-los-rosales-2-habitaciones-4-banos-3-garajes/464-M5742999';
const CC = 'https://www.ciencuadras.com/inmueble/apartamento-en-arriendo-en-los-rosales-bogota-3856524';
const live = fs.readFileSync(
  path.resolve(process.cwd(), 'lib/scrapers/__fixtures__/fincaraiz/apartaestudio-venta-cali-193349683.html'),
  'utf-8'
);

console.log('LIVENESS CLASSIFIER TEST');
console.log('\n━━ Retirado ━━');
eq('Fincaraiz 301 → ?addeletedid', classifyListingPage({
  url: FR, status: 301, location: 'https://www.fincaraiz.com.co/arriendo/apartamentos?addeletedid=193897133',
}), 'gone');
eq('Fincaraiz 200 con aviso', classifyListingPage({
  url: FR, status: 200,
  html: '<h4>Estás viendo esta página porque la propiedad que estabas buscando no está disponible.</h4>',
}), 'gone');
eq('Metrocuadrado 200 con aviso', classifyListingPage({
  url: M2, status: 200, html: '<p> Parece que este inmueble no está disponible. O está en proceso de p</p>',
}), 'gone');
eq('Ciencuadras 200 con aviso', classifyListingPage({
  url: CC, status: 200, html: '<span> Este inmueble ya no está disponible. Mira otras opciones</span>',
}), 'gone');
eq('404', classifyListingPage({ url: FR, status: 404 }), 'gone');
eq('410', classifyListingPage({ url: FR, status: 410 }), 'gone');
eq('redirect a otro aviso (sin el id)', classifyListingPage({
  url: FR, status: 301, location: 'https://www.fincaraiz.com.co/apartamento-en-arriendo-en-teusaquillo-bogota/193708000',
}), 'gone');

console.log('\n━━ Vivo ━━');
eq('ficha real de Fincaraiz', classifyListingPage({ url: FR, status: 200, html: live }), 'live');
eq('"no está disponible" en la descripción no cuenta', classifyListingPage({
  url: M2, status: 200, html: '<p>El parqueadero de visitantes no está disponible los domingos.</p>',
}), 'live');
eq('redirect al mismo aviso (canónico)', classifyListingPage({
  url: FR, status: 301, location: `${FR}/`,
}), 'live');

console.log('\n━━ Sin veredicto → no esconder ━━');
eq('403 (bloqueo)', classifyListingPage({ url: FR, status: 403 }), 'unknown');
eq('500', classifyListingPage({ url: FR, status: 500 }), 'unknown');
eq('sin respuesta', classifyListingPage({ url: FR, status: null }), 'unknown');

if (failures > 0) {
  console.log(`\n❌ ${failures} fallo(s)`);
  process.exit(1);
}
console.log('\n✅ liveness OK');
