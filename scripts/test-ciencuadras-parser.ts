// scripts/test-ciencuadras-parser.ts
// Smoke test del parser Ciencuadras contra fixtures locales.

import fs from 'fs';
import path from 'path';
import {
  parseCiencuadrasListing,
  parseCiencuadrasSlug,
} from '../lib/scrapers/ciencuadras';

const FIX = path.resolve(process.cwd(), 'lib/scrapers/__fixtures__/ciencuadras');

console.log('='.repeat(60));
console.log('CIENCUADRAS PARSER SMOKE TEST');
console.log('='.repeat(60));

// Slug parsing
console.log('\n━━ Slug parsing tests ━━');
const slugs = [
  'https://www.ciencuadras.com/inmueble/apartamento-en-venta-en-tuna-alta-bogota-3713891',
  'https://www.ciencuadras.com/inmueble/casa-en-venta-en-casa-blanca-suba-bogota-3091390',
  'https://www.ciencuadras.com/inmueble/oficina-en-venta-en-bella-suiza-bogota-3499669',
  'https://www.ciencuadras.com/inmueble/apartamento-en-arriendo-en-chapinero-bogota-1234567',
];
for (const u of slugs) {
  const s = parseCiencuadrasSlug(u);
  console.log(`  ${u.split('/').pop()?.slice(0, 60)}`);
  console.log(`    →`, s);
}

// Detail parsing
console.log('\n━━ Detail page parsing ━━');
const html = fs.readFileSync(path.join(FIX, 'detail-tuna-alta-venta.html'), 'utf-8');
const url = 'https://www.ciencuadras.com/inmueble/apartamento-en-venta-en-tuna-alta-bogota-3713891';
const item = parseCiencuadrasListing(url, html);
if (!item) {
  console.log('  ❌ parseCiencuadrasListing returned null');
} else {
  console.log('  ✅ parsed');
  console.log(`    title:        ${item.title}`);
  console.log(`    type / op:    ${item.property_type} ${item.listing_type}`);
  console.log(`    city / hood:  ${item.city} / ${item.neighborhood ?? '—'}`);
  console.log(
    `    price:        $${item.price_cop.toLocaleString('es-CO')} | ${item.bedrooms ?? '?'}h/${item.bathrooms ?? '?'}b/${item.area_m2 ?? '?'}m²`
  );
  console.log(`    geo:          ${item.latitude} / ${item.longitude}`);
  console.log(`    photos:       ${item.photos.length}`);
  console.log(`    desc:         ${item.description?.slice(0, 100)}…`);
}

console.log('\nDONE');
