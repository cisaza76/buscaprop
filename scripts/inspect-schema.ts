import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  // SELECT * LIMIT 1 — keys = columnas existentes.
  const r = await fetch(`${url}/rest/v1/properties?select=*&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const rows = await r.json();
  console.log(`HTTP ${r.status}`);
  if (Array.isArray(rows) && rows[0]) {
    const cols = Object.keys(rows[0]).sort();
    console.log(`Columnas en properties (${cols.length}):`);
    for (const c of cols) console.log(`  - ${c}`);

    // Comparar contra lo que el upsert espera escribir
    const expected = [
      'source_portal','source_url','title','description','price_cop','city','neighborhood',
      'bedrooms','bathrooms','area_m2','property_type','listing_type','photos',
      'latitude','longitude','is_duplicate','canonical_id','dedup_hash','scraped_at',
    ];
    const missing = expected.filter((c) => !cols.includes(c));
    console.log(`\nFaltantes para el scraper: ${missing.length === 0 ? 'NINGUNA ✅' : missing.join(', ')}`);
  } else {
    console.log('No data:', JSON.stringify(rows).slice(0, 200));
  }
}
main();
