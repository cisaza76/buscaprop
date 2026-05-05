// scripts/check-coords-coverage.ts
// Diagnóstico de cobertura de lat/lng por portal — pre-requisito para la
// integración con IDECA (Capa 1 del Path D, Phase 10).
//
// Equivalente JS al SELECT GROUP BY source_portal — Supabase JS no expone
// raw SQL desde service-role sin exec_sql RPC, así que iteramos por portal.

import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });

const PORTALS = ['fincaraiz', 'metrocuadrado', 'properati', 'ciencuadras'] as const;

async function main() {
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  console.log('\n──── Cobertura de lat/lng por portal ────');
  console.log(
    'portal'.padEnd(15) +
      'total'.padStart(8) +
      'with_coords'.padStart(15) +
      'coverage_pct'.padStart(15)
  );
  console.log('─'.repeat(53));

  let grandTotal = 0;
  let grandWithCoords = 0;

  for (const portal of PORTALS) {
    // Total por portal.
    const { count: total, error: e1 } = await sb
      .from('properties')
      .select('*', { count: 'exact', head: true })
      .eq('source_portal', portal);
    if (e1) {
      console.log(`${portal.padEnd(15)} ❌ ${e1.message}`);
      continue;
    }

    // Con coords (latitude AND longitude not null).
    const { count: withCoords, error: e2 } = await sb
      .from('properties')
      .select('*', { count: 'exact', head: true })
      .eq('source_portal', portal)
      .not('latitude', 'is', null)
      .not('longitude', 'is', null);
    if (e2) {
      console.log(`${portal.padEnd(15)} ❌ ${e2.message}`);
      continue;
    }

    const t = total ?? 0;
    const wc = withCoords ?? 0;
    const pct = t > 0 ? Math.round((wc / t) * 1000) / 10 : 0;

    grandTotal += t;
    grandWithCoords += wc;

    console.log(
      portal.padEnd(15) +
        String(t).padStart(8) +
        String(wc).padStart(15) +
        `${pct.toFixed(1)}%`.padStart(15)
    );
  }

  console.log('─'.repeat(53));
  const grandPct = grandTotal > 0 ? Math.round((grandWithCoords / grandTotal) * 1000) / 10 : 0;
  console.log(
    'TOTAL'.padEnd(15) +
      String(grandTotal).padStart(8) +
      String(grandWithCoords).padStart(15) +
      `${grandPct.toFixed(1)}%`.padStart(15)
  );

  // Sample 5 propiedades CON coords para inspeccionar valores reales.
  console.log('\n──── Sample con coords (5 random) ────');
  const { data: sample } = await sb
    .from('properties')
    .select('source_portal, city, neighborhood, latitude, longitude, is_duplicate')
    .not('latitude', 'is', null)
    .not('longitude', 'is', null)
    .limit(5);
  for (const p of sample ?? []) {
    console.log(
      `  ${p.source_portal.padEnd(13)} ${(p.city ?? '?').padEnd(10)} ${(p.neighborhood ?? '—').padEnd(20)} (${p.latitude}, ${p.longitude})${p.is_duplicate ? ' [dup]' : ''}`
    );
  }

  // Verificar también cuántas tienen city='Bogotá' que es el target inicial de IDECA.
  console.log('\n──── Bogotá específicamente ────');
  const { count: bogTotal } = await sb
    .from('properties')
    .select('*', { count: 'exact', head: true })
    .eq('city', 'Bogotá');
  const { count: bogWithCoords } = await sb
    .from('properties')
    .select('*', { count: 'exact', head: true })
    .eq('city', 'Bogotá')
    .not('latitude', 'is', null)
    .not('longitude', 'is', null);
  const bogPct = (bogTotal ?? 0) > 0 ? Math.round(((bogWithCoords ?? 0) / (bogTotal ?? 1)) * 1000) / 10 : 0;
  console.log(`  total Bogotá: ${bogTotal ?? 0}`);
  console.log(`  con coords:   ${bogWithCoords ?? 0} (${bogPct.toFixed(1)}%)`);

  // Decisión rápida.
  console.log('\n──── Implicaciones para Phase 10 (IDECA) ────');
  if (grandPct >= 70) {
    console.log(`✅ Cobertura saludable (${grandPct}%). Capa 1 (IDECA enrichment) viable directo.`);
  } else if (grandPct >= 30) {
    console.log(
      `⚠️  Cobertura parcial (${grandPct}%). Para las propiedades sin coords vamos a necesitar ` +
        `geocoding (dirección → lat/lng) antes de pegarle a IDECA. Opciones: Nominatim (gratis, ` +
        `rate limit), Google Maps Geocoding ($5/1000), Mapbox.`
    );
  } else {
    console.log(
      `❌ Cobertura baja (${grandPct}%). Antes de Capa 1 hay que mejorar los scrapers para ` +
        `extraer lat/lng (la mayoría de portales lo exponen en JSON-LD o data-attributes), ` +
        `o agregar paso de geocoding masivo.`
    );
  }
}

main().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
