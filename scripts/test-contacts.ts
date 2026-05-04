// Smoke test offline: verifica extracción de contact_name / contact_phone /
// company_name de cada parser usando fixtures.
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function main() {
  const FIX = path.resolve(process.cwd(), 'lib/scrapers/__fixtures__');

  // M2: search-only (contactPhone + whatsapp inline)
  console.log('═══ M2 (search results inline) ═══');
  const { parseProperatiSearchPage } = await import('../lib/scrapers/properati');
  const { extractRscChunks, extractSearchResults, mapSearchResultToProperty } = await import('../lib/scrapers/metrocuadrado');
  const m2html = fs.readFileSync(path.join(FIX, 'metrocuadrado/search-apto-venta-bogota.html'), 'utf-8');
  const chunks = extractRscChunks(m2html);
  const raw = extractSearchResults(chunks);
  const m2sample = raw?.slice(0, 5).map((r) => mapSearchResultToProperty(r, 'https://www.metrocuadrado.com/apartamento/venta/bogota/')).filter(Boolean);
  for (const p of (m2sample as any[]) ?? []) {
    console.log(`  ${p.title?.slice(0,40)}`);
    console.log(`    contact_phone: ${p.contact_phone ?? '—'}`);
    console.log(`    company_name:  ${p.company_name ?? '—'}`);
  }
  // Cobertura M2
  const m2all = (raw ?? []).map((r) => mapSearchResultToProperty(r, 'https://www.metrocuadrado.com/apartamento/venta/bogota/')).filter(Boolean) as any[];
  const m2withPhone = m2all.filter((p) => p.contact_phone).length;
  console.log(`  COBERTURA: ${m2withPhone}/${m2all.length} con contact_phone`);

  // Fincaraíz: detail-page JSON-LD landlord
  console.log('\n═══ Fincaraíz (JSON-LD landlord) ═══');
  // No tenemos fixture FR — usemos /tmp si existe
  try {
    const frhtml = fs.readFileSync('/tmp/buscaprop-recon/pages/fr-apto-individual.html', 'utf-8');
    const { parseFincaraizListing } = await import('../lib/scrapers/fincaraiz');
    const url = 'https://www.fincaraiz.com.co/apartaestudio-en-venta-en-chico-navarra-bogota/193487964';
    const item = parseFincaraizListing(url, frhtml);
    if (item) {
      console.log(`  title: ${item.title?.slice(0,50)}`);
      console.log(`    contact_name:  ${item.contact_name ?? '—'}`);
      console.log(`    company_name:  ${item.company_name ?? '—'}`);
      console.log(`    contact_phone: ${item.contact_phone ?? '—'}`);
    }
  } catch (e) {
    console.log('  (no fixture FR disponible — OK, se valida en run live)');
  }

  // Properati: search card data-test agency-name
  console.log('\n═══ Properati (search card agency-name) ═══');
  const prhtml = fs.readFileSync(path.join(FIX, 'properati/search-bogota-apartamento-venta-p1.html'), 'utf-8').toString();
  if (!prhtml.includes('data-idanuncio')) {
    console.log('  fixture sin data-idanuncio (?), saltando');
  } else {
    const items = parseProperatiSearchPage(
      'https://www.properati.com.co/s/bogota-d-c-colombia/apartamento/venta',
      prhtml,
      { propertyType: 'apartamento', listingType: 'venta' }
    );
    for (const p of items.slice(0, 5)) {
      console.log(`  ${p.title?.slice(0,40)}`);
      console.log(`    contact_name: ${p.contact_name ?? '—'}`);
      console.log(`    company_name: ${p.company_name ?? '—'}`);
    }
    const withName = items.filter((p) => p.contact_name || p.company_name).length;
    console.log(`  COBERTURA: ${withName}/${items.length} con contact_name o company_name`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
