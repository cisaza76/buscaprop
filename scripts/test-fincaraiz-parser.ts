// scripts/test-fincaraiz-parser.ts
// Test del parser de detalle de Fincaraiz contra una ficha real guardada como
// fixture (datos del anunciante anonimizados). NO toca red.
//
// Regresión que cubre (medido 2026-09-27): Fincaraiz cambió su JSON-LD de
// SaleAction/RentAction + priceSpecification a RealEstateListing + offers +
// mainEntity. El parser dejó de encontrar el precio estructurado, caía al
// regex "primer $ del HTML" y guardaba cifras de la descripción: esta ficha
// vale $265M y quedó en $2.6M (el arriendo por Airbnb que menciona el texto).
// ~3.200 ventas de Fincaraiz por debajo de $30M salían de ahí.

import fs from 'node:fs';
import path from 'node:path';
import { parseFincaraizListing } from '../lib/scrapers/fincaraiz';

const FIX = path.resolve(process.cwd(), 'lib/scrapers/__fixtures__/fincaraiz');
const URL = 'https://www.fincaraiz.com.co/apartaestudio-en-venta-en-cali/193349683';

let failures = 0;
function eq(name: string, got: unknown, want: unknown) {
  if (got === want) console.log(`  ✅ ${name}`);
  else {
    console.log(`  ❌ ${name} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    failures++;
  }
}

console.log('FINCARAIZ PARSER TEST (offline, fixtures)');

const html = fs.readFileSync(path.join(FIX, 'apartaestudio-venta-cali-193349683.html'), 'utf-8');
const p = parseFincaraizListing(URL, html);

console.log('\n━━ RealEstateListing (JSON-LD 2026) ━━');
eq('parsea', p != null, true);
eq('precio de offers.price, no el $ de la descripción', p?.price_cop, 265_000_000);
eq('habitaciones de mainEntity', p?.bedrooms, 1);
eq('baños de mainEntity', p?.bathrooms, 1);
eq('área de mainEntity.floorSize', p?.area_m2, 40);
eq('latitud de mainEntity.geo', p?.latitude, 3.4621307756209);
eq('longitud de mainEntity.geo', p?.longitude, -76.531481002516);
eq('operación', p?.listing_type, 'venta');
eq('ciudad', p?.city, 'Cali');

console.log('\n━━ Sin JSON-LD → precio del estado de la página, del aviso correcto ━━');
// Hay fichas vivas que solo traen el BreadcrumbList (medido 2026-09-28: ~1 de
// cada 4 en el re-scrape). El precio sigue en el estado Apollo, en el nodo
// cuyo "code" es el id del aviso — NO "el primer $ de la página".
const noLd = html.replace(/<script[^>]*application\/ld\+json[^>]*>[\s\S]*?<\/script>/g, '');
const q = parseFincaraizListing(URL, noLd);
eq('precio del nodo con code=id', q?.price_cop, 265_000_000);

// Variante vista en fichas de Cartagena (2026-09-28): __typename primero y
// hidePrice después de currency.
const typed = noLd.replace(
  /"price":\{"amount":265000000,"admin_included":265450000,"hidePrice":false,"currency":\{([^}]*)\}\}/,
  '"price":{"__typename":"Price","amount":265000000,"currency":{$1},"hidePrice":false}'
);
eq('variante con __typename', typed !== noLd && parseFincaraizListing(URL, typed)?.price_cop, 265_000_000);

// Si el nodo del aviso no está (o esconde el precio), descartar: los $ que
// quedan son de otros avisos o de la descripción.
const noNode = noLd.replace(/"code":"193349683"/g, '"code":"999"');
eq('sin nodo del aviso → descarta', parseFincaraizListing(URL, noNode), null);
// Nodo del aviso sin precio seguido de otro aviso con precio: no tomar el ajeno.
const neighbor = noLd.replace('"price":{"amount":265000000', '"code":"555","price":{"amount":265000000');
eq('no toma el precio del aviso vecino', parseFincaraizListing(URL, neighbor), null);
const hidden = noLd.replace('"hidePrice":false', '"hidePrice":true');
eq('hidePrice:true → descarta', parseFincaraizListing(URL, hidden), null);

if (failures > 0) {
  console.log(`\n❌ ${failures} fallo(s)`);
  process.exit(1);
}
console.log('\n✅ fincaraiz parser OK');
