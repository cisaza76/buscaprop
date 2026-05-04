// scripts/test-m2-parser.ts
// Smoke test del parser M2 contra fixtures locales (no toca el servidor).

import fs from 'fs';
import path from 'path';
import {
  extractRscChunks,
  extractSearchResults,
  extractDetailData,
  mapSearchResultToProperty,
} from '../lib/scrapers/metrocuadrado';

const FIX = path.resolve(process.cwd(), 'lib/scrapers/__fixtures__/metrocuadrado');

function read(name: string): string {
  return fs.readFileSync(path.join(FIX, name), 'utf-8');
}

function checkSearch(file: string, expectedUrl: string) {
  console.log(`\n━━ ${file} ━━`);
  const html = read(file);
  const chunks = extractRscChunks(html);
  console.log(`  RSC chunks decoded: ${chunks.length}`);
  const results = extractSearchResults(chunks);
  if (!results) {
    console.log('  ❌ extractSearchResults returned null');
    return;
  }
  console.log(`  results array length: ${results.length}`);
  const mapped = results
    .map((r) => mapSearchResultToProperty(r, expectedUrl))
    .filter((p): p is NonNullable<typeof p> => !!p);
  console.log(`  mapped (non-null): ${mapped.length}`);
  if (mapped.length > 0) {
    const sample = mapped[0];
    console.log('  Sample:');
    console.log(`    title:        ${sample.title?.slice(0, 70)}`);
    console.log(`    type / op:    ${sample.property_type} ${sample.listing_type}`);
    console.log(`    city / hood:  ${sample.city} / ${sample.neighborhood ?? '—'}`);
    console.log(
      `    price:        $${sample.price_cop.toLocaleString('es-CO')} | ${sample.bedrooms ?? '?'}h/${sample.bathrooms ?? '?'}b/${sample.area_m2 ?? '?'}m²`
    );
    console.log(`    photos:       ${sample.photos.length} (${sample.photos[0]?.slice(0, 80) ?? '—'})`);
    console.log(`    url:          ${sample.source_url}`);
  }

  // Diagnóstico de campos faltantes
  const missing = {
    no_price: mapped.filter((p) => !p.price_cop).length,
    no_city: mapped.filter((p) => !p.city).length,
    no_neighborhood: mapped.filter((p) => !p.neighborhood).length,
    no_bedrooms: mapped.filter((p) => p.bedrooms == null).length,
    no_bathrooms: mapped.filter((p) => p.bathrooms == null).length,
    no_area: mapped.filter((p) => p.area_m2 == null).length,
    no_photos: mapped.filter((p) => p.photos.length === 0).length,
  };
  console.log('  Coverage gaps:', missing);
}

function checkDetail(file: string) {
  console.log(`\n━━ ${file} ━━`);
  const html = read(file);
  const chunks = extractRscChunks(html);
  const data = extractDetailData(chunks);
  if (!data) {
    console.log('  ❌ extractDetailData returned null');
    return;
  }
  console.log('  ✅ data extracted, keys:', Object.keys(data).slice(0, 15).join(', '), '…');
  console.log(`  propertyId:   ${data.propertyId}`);
  console.log(`  salePrice:    ${data.salePrice}`);
  console.log(`  rentPrice:    ${data.rentPrice}`);
  console.log(`  area:         ${data.area}`);
  console.log(`  rooms/baths:  ${data.rooms} / ${data.bathrooms}`);
  console.log(`  city / hood:  ${data.city?.nombre} / ${data.neighborhood}`);
  console.log(
    `  coords:       lat=${data.coordinates?.lat}, lon=${data.coordinates?.lon}`
  );
  console.log(`  images:       ${data.images?.length ?? 0}`);
  console.log(`  comment:      ${(data.comment ?? '').slice(0, 100)}…`);
}

console.log('='.repeat(60));
console.log('M2 PARSER SMOKE TEST (offline, fixtures)');
console.log('='.repeat(60));

checkSearch(
  'search-apto-venta-bogota.html',
  'https://www.metrocuadrado.com/apartamento/venta/bogota/'
);
checkSearch(
  'search-casa-venta-bogota.html',
  'https://www.metrocuadrado.com/casa/venta/bogota/'
);

checkDetail('detail-rosales-venta.html');
checkDetail('detail-toberin-venta.html');

console.log('\nDONE');
