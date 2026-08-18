// scripts/diag-supabase-env.ts
// Diagnóstico del boundary env → cliente Supabase → PostgREST.
// Pensado para correr DENTRO del entorno que falla (GitHub Actions) y
// compararlo contra local. No imprime secretos: sólo forma derivada.
import './_load-env';
import { createClient } from '@supabase/supabase-js';
import { normalizeSupabaseUrl } from '../lib/supabase-url';

function shape(name: string, v: string | undefined) {
  if (!v) return console.log(`  ${name.padEnd(30)} UNSET`);
  console.log(
    `  ${name.padEnd(30)} len=${v.length} proto=${v.startsWith('https://') ? 'https' : v.startsWith('http://') ? 'http' : '??'} ` +
      `trailingSlash=${v.endsWith('/')} hasPath=${/^https?:\/\/[^/]+\/.+/.test(v)} ` +
      `prefix=${v.slice(0, 3)}… whitespace=${/\s/.test(v)}`
  );
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  console.log('━━ 1. Forma de las env vars (sin revelar valores) ━━');
  shape('NEXT_PUBLIC_SUPABASE_URL', url);
  shape('SUPABASE_SERVICE_ROLE_KEY', key);
  console.log(`  key kind: ${key?.startsWith('eyJ') ? 'JWT legacy' : key?.startsWith('sb_') ? 'sb_ nueva' : 'desconocida'}`);

  console.log('\n━━ 2. Versión instalada ━━');
  for (const p of ['@supabase/supabase-js', '@supabase/postgrest-js']) {
    try {
      console.log(`  ${p.padEnd(26)} ${require(`${p}/package.json`).version}`);
    } catch { console.log(`  ${p.padEnd(26)} no resoluble`); }
  }
  console.log(`  node ${process.version}`);

  if (!url || !key) { console.log('\nfaltan env vars — abortando'); return; }

  const normalized = normalizeSupabaseUrl(url);
  console.log(`\n  normalizeSupabaseUrl: len ${url.trim().length} → ${normalized.length} (${url.trim() === normalized ? 'sin cambio' : 'CORREGIDA'})`);

  console.log('\n━━ 3. fetch CRUDO a PostgREST (sin supabase-js) ━━');
  const probe = async (label: string, base: string) => {
    const target = `${base.replace(/\/$/, '')}/rest/v1/properties?select=id&limit=1`;
    try {
      const res = await fetch(target, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
      const body = await res.text();
      console.log(`  ${label}: HTTP ${res.status} — ${body.slice(0, 140)}`);
    } catch (e) {
      console.log(`  ${label}: fetch lanzó ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  await probe('URL cruda del secret ', url);
  await probe('URL normalizada     ', normalized);

  console.log('\n━━ 4. Las 4 llamadas que fallaban en el cron (cliente normalizado) ━━');
  const sb = createClient(normalized, key, { auth: { persistSession: false } });
  const show = (label: string, error: unknown, extra = '') => {
    if (!error) return console.log(`  ✅ ${label.padEnd(34)} OK ${extra}`);
    const e = error as Record<string, unknown>;
    console.log(`  ❌ ${label.padEnd(34)} code=${e.code} msg=${e.message} details=${e.details} hint=${e.hint}`);
  };
  show('select 5 columnas opcionales',
    (await sb.from('properties').select('dedup_hash,contact_name,contact_phone,company_name,source_lastmod').limit(1)).error);
  const stale = await sb.from('properties').select('id, price_cop').eq('source_portal', 'ciencuadras')
    .lt('scraped_at', new Date(Date.now() - 7 * 864e5).toISOString());
  show('markDelisted stale query', stale.error, `filas=${stale.data?.length}`);
  show('scrape_attempts select', (await sb.from('scrape_attempts').select('id').limit(1)).error);
  // Upsert real contra una fila existente: idempotente, no crea nada nuevo.
  const { data: sample } = await sb.from('properties')
    .select('source_portal, source_url, title, price_cop, city, property_type, listing_type, photos, scraped_at')
    .eq('source_portal', 'ciencuadras').limit(1).single();
  if (sample) {
    show('upsert idempotente (fila existente)',
      (await sb.from('properties').upsert(sample, { onConflict: 'source_portal,source_url', ignoreDuplicates: false })
        .select('id, created_at, updated_at').single()).error);
  }
}
main();
