// scripts/probe-coords-urls.ts
// Saca URLs reales de Properati y MetroCuadrado del DB para inspeccionar.
// Filtra por las que NO tengan coords (que es donde necesitamos el fix).

import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });

async function main() {
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  for (const portal of ['properati', 'metrocuadrado']) {
    console.log(`\n──── ${portal} (sin coords) ────`);
    const { data: noCoords } = await sb
      .from('properties')
      .select('source_url, city, neighborhood, title, latitude, longitude')
      .eq('source_portal', portal)
      .is('latitude', null)
      .limit(3);
    for (const p of noCoords ?? []) {
      console.log(`  ${p.source_url}`);
      console.log(`    ${p.title?.slice(0, 60)}... · ${p.city}/${p.neighborhood ?? '—'}`);
    }

    console.log(`──── ${portal} (con coords, sample) ────`);
    const { data: withCoords } = await sb
      .from('properties')
      .select('source_url, city, neighborhood, title, latitude, longitude')
      .eq('source_portal', portal)
      .not('latitude', 'is', null)
      .limit(3);
    for (const p of withCoords ?? []) {
      console.log(`  ${p.source_url}`);
      console.log(
        `    ${p.title?.slice(0, 60)}... · ${p.city}/${p.neighborhood ?? '—'} (${p.latitude}, ${p.longitude})`
      );
    }
  }
}

main();
