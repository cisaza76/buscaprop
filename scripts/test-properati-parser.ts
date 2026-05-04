// scripts/test-properati-parser.ts
// Smoke test del parser Properati contra fixtures locales.

import fs from 'fs';
import path from 'path';
import { parseProperatiSearchPage } from '../lib/scrapers/properati';

const FIX = path.resolve(process.cwd(), 'lib/scrapers/__fixtures__/properati');

function check(file: string, ctx: { propertyType: string; listingType: string }) {
  console.log(`\n━━ ${file} (${ctx.propertyType}/${ctx.listingType}) ━━`);
  const html = fs.readFileSync(path.join(FIX, file), 'utf-8');
  const url = `https://www.properati.com.co/s/bogota-d-c-colombia/${ctx.propertyType}/${ctx.listingType}`;
  const items = parseProperatiSearchPage(url, html, ctx);
  console.log(`  parsed cards: ${items.length}`);

  if (items.length > 0) {
    const sample = items[0];
    console.log('  Sample:');
    console.log(`    title:   ${sample.title?.slice(0, 70)}`);
    console.log(`    type/op: ${sample.property_type} ${sample.listing_type}`);
    console.log(`    where:   ${sample.city} / ${sample.neighborhood ?? '—'}`);
    console.log(
      `    price:   $${sample.price_cop.toLocaleString('es-CO')} | ${sample.bedrooms ?? '?'}h/${sample.bathrooms ?? '?'}b/${sample.area_m2 ?? '?'}m²`
    );
    console.log(`    photos:  ${sample.photos.length} (first: ${sample.photos[0]?.slice(0, 80) ?? '—'})`);
    console.log(`    url:     ${sample.source_url}`);
  }

  const gaps = {
    no_price: items.filter((p) => !p.price_cop).length,
    no_city: items.filter((p) => !p.city).length,
    no_hood: items.filter((p) => !p.neighborhood).length,
    no_beds: items.filter((p) => p.bedrooms == null).length,
    no_baths: items.filter((p) => p.bathrooms == null).length,
    no_area: items.filter((p) => p.area_m2 == null).length,
    no_photos: items.filter((p) => p.photos.length === 0).length,
  };
  console.log('  Coverage gaps:', gaps);
}

console.log('='.repeat(60));
console.log('PROPERATI PARSER SMOKE TEST');
console.log('='.repeat(60));

check('search-bogota-apartamento-venta-p1.html', { propertyType: 'apartamento', listingType: 'venta' });
check('search-bogota-apartamento-venta-p2.html', { propertyType: 'apartamento', listingType: 'venta' });

console.log('\nDONE');
