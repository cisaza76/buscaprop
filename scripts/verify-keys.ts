import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  console.log('URL:', url);
  console.log('ANON   len:', anon.length, 'prefix:', anon.slice(0, 18));
  console.log('SERVICE len:', service.length, 'prefix:', service.slice(0, 18));

  for (const [label, key] of [['ANON', anon], ['SERVICE', service]] as const) {
    const r = await fetch(`${url}/rest/v1/properties?select=count`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact', Range: '0-0' },
    });
    console.log(`${label}: HTTP ${r.status} — ${(await r.text()).slice(0, 220)}`);
  }
}
main();
