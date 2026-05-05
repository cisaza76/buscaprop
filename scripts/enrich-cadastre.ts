// scripts/enrich-cadastre.ts
// Enrichment masivo de property_cadastral via IDECA.
//
// Estrategia:
//   1. Encontrar propiedades de Bogotá con coords y SIN entrada en
//      property_cadastral (o con status='error' para retry).
//   2. Por cada propiedad, hacer las 4 queries IDECA en paralelo (rápido).
//   3. Entre propiedades, sleep 500ms — total ~4 queries × 1.5K props /
//      2 props/seg = ~13 minutos para 1500-2000 props. Carga moderada
//      sobre el servidor IDECA.
//
// Idempotente: re-correr no duplica filas (upsert por property_id).
//
// Uso:
//   npx tsx scripts/enrich-cadastre.ts [--limit N] [--retry-errors]
//
// Flags:
//   --limit N         máximo N propiedades en esta corrida
//   --retry-errors    re-procesar las que tienen status='error'
//   --dry-run         no escribir a DB, solo loguear
//   --verbose         imprimir cada query

import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });

const SLEEP_MS_BETWEEN_PROPERTIES = 500;
const DEFAULT_LIMIT = 5000;

interface CliArgs {
  limit: number;
  retryErrors: boolean;
  dryRun: boolean;
  verbose: boolean;
  city: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const out: CliArgs = {
    limit: DEFAULT_LIMIT,
    retryErrors: false,
    dryRun: false,
    verbose: false,
    city: 'Bogotá',
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--limit') out.limit = Number(args[++i]) || DEFAULT_LIMIT;
    else if (a === '--retry-errors') out.retryErrors = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--verbose') out.verbose = true;
    else if (a === '--city') out.city = args[++i] ?? 'Bogotá';
  }
  return out;
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const args = parseArgs();
  console.log(`\n🗺️  Enrichment catastral via IDECA`);
  console.log(`   city=${args.city} limit=${args.limit} retryErrors=${args.retryErrors} dryRun=${args.dryRun}`);

  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  // 1. Encontrar propiedades de la ciudad target con coords y sin enrich
  //    (o con error si retryErrors). Hacemos un join manual: traemos las que
  //    sí están enriquecidas y las excluimos.
  const { data: alreadyEnriched, error: e1 } = await sb
    .from('property_cadastral')
    .select('property_id, status');
  if (e1) {
    console.error(
      `❌ No pude leer property_cadastral. ¿Aplicaste migration 010?\n   ${e1.message}`
    );
    process.exit(1);
  }
  const enrichedSet = new Set<string>();
  const errorSet = new Set<string>();
  for (const row of alreadyEnriched ?? []) {
    if (row.status === 'error') errorSet.add(row.property_id);
    else enrichedSet.add(row.property_id);
  }
  console.log(
    `   Ya enriquecidas: ${enrichedSet.size} (verified/not_found) + ${errorSet.size} con error`
  );

  // 2. Pedir candidatos.
  let q = sb
    .from('properties')
    .select('id, latitude, longitude, city, source_portal')
    .eq('city', args.city)
    .not('latitude', 'is', null)
    .not('longitude', 'is', null)
    .eq('is_duplicate', false)
    .limit(args.limit + enrichedSet.size + errorSet.size); // generoso porque vamos a filtrar

  const { data: candidates, error: e2 } = await q;
  if (e2) {
    console.error(`❌ Query de candidatos falló: ${e2.message}`);
    process.exit(1);
  }

  // Filtro: si retryErrors=true incluimos los con error; si no, solo nuevos.
  const skip = args.retryErrors ? enrichedSet : new Set([...enrichedSet, ...errorSet]);
  const todo = (candidates ?? [])
    .filter((p) => !skip.has(p.id as string))
    .slice(0, args.limit);

  console.log(`   Candidatos a procesar: ${todo.length}`);
  if (todo.length === 0) {
    console.log(`   ✅ Nada pendiente. Salir.`);
    return;
  }

  // 3. Procesar.
  const stats = { verified: 0, not_found: 0, error: 0 };
  const t0 = Date.now();

  for (let i = 0; i < todo.length; i++) {
    const p = todo[i] as {
      id: string;
      latitude: number;
      longitude: number;
      source_portal: string;
    };
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const eta = todo.length > i + 1
      ? (((Date.now() - t0) / Math.max(1, i)) * (todo.length - i - 1) / 1000).toFixed(0)
      : '0';

    if (args.dryRun) {
      console.log(
        `[${i + 1}/${todo.length}] DRY-RUN ${p.id} (${p.latitude}, ${p.longitude})`
      );
    } else {
      const { enrichProperty } = await import('../lib/cadastre/repository');
      try {
        const r = await enrichProperty({
          propertyId: p.id,
          latitude: p.latitude,
          longitude: p.longitude,
        });
        stats[r.status]++;
        if (args.verbose || r.status !== 'verified') {
          const desc =
            r.status === 'verified'
              ? `lot=${r.lot_code} sector="${r.sector_name}" area=${r.lot_area_m2}m²`
              : r.status === 'not_found'
              ? '(coords fuera de catastro Bogotá)'
              : `error: ${r.error_message}`;
          console.log(
            `[${i + 1}/${todo.length}] ${p.source_portal.padEnd(13)} ${r.status.padEnd(10)} · ${desc}`
          );
        } else if ((i + 1) % 25 === 0) {
          console.log(
            `[${i + 1}/${todo.length}] elapsed=${elapsed}s eta=${eta}s · v=${stats.verified} nf=${stats.not_found} e=${stats.error}`
          );
        }
      } catch (err) {
        console.warn(`[${i + 1}/${todo.length}] FATAL: ${err}`);
        stats.error++;
      }
    }

    if (i < todo.length - 1) await sleep(SLEEP_MS_BETWEEN_PROPERTIES);
  }

  const totalSec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n──── Done en ${totalSec}s ────`);
  console.log(`  verified:  ${stats.verified}`);
  console.log(`  not_found: ${stats.not_found}`);
  console.log(`  error:     ${stats.error}`);
}

main().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
