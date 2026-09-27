// scripts/backfill-city-slugs.ts
// Backfill puntual de `properties.city` para filas que entraron con la ciudad
// mal normalizada desde el slug de Fincaraiz (ver test-city-normalization.ts):
//
//   1. Slug con guion: "El-retiro", "La-ceja", "La-estrella"… → canonicalCity()
//      (~6.500 filas al 2026-09-26). El chat filtra city con igualdad exacta,
//      así que "El Retiro" encontraba 25 de ~3.300.
//   2. Puerto Colombia partido: city="Colombia" + barrio "Puerto"/"Salgar Puerto"
//      → city="Puerto Colombia", barrio sin el "Puerto" sobrante (988 filas).
//
// CORRER DESPUÉS de desplegar el fix del parser: si no, el próximo upsert de
// cada fila vuelve a escribir la ciudad vieja.
//
// Uso:
//   npx tsx scripts/backfill-city-slugs.ts           # DRY RUN — no escribe
//   npx tsx scripts/backfill-city-slugs.ts --apply   # escribe
//
// Idempotente: una segunda corrida no encuentra nada que cambiar.

import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });

import { canonicalCity } from '../lib/scrapers/shared/normalize';

const PAGE = 1000;

async function main() {
  const apply = process.argv.includes('--apply');
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  console.log(apply ? '\n✍️  APPLY — escribe en BD' : '\n🔍 DRY RUN — no escribe (usa --apply)');

  // ── 1. Ciudades con guion ────────────────────────────────────────────────
  // Descubrir los valores distintos: cada consulta excluye los ya vistos, así
  // que siempre trae ciudades nuevas y termina cuando no queda ninguna. Ni
  // offset ni keyset por id: con un LIKE sin índice ambos recorren la tabla y
  // el statement timeout los corta (probado 2026-09-26).
  const seen: string[] = [];
  for (;;) {
    let q = sb.from('properties').select('city').like('city', '%-%').limit(PAGE);
    if (seen.length) q = q.not('city', 'in', `(${seen.map((c) => `"${c}"`).join(',')})`);
    const { data, error } = await q;
    if (error) throw new Error(`leer ciudades con guion: ${error.message}`);
    const fresh = [...new Set((data ?? []).map((r) => r.city as string))];
    if (!fresh.length) break;
    seen.push(...fresh);
  }
  // Conteo exacto por ciudad: usa el índice (city, …) de la migración 021.
  const counts = new Map<string, number>();
  for (const city of seen) {
    const { count, error } = await sb
      .from('properties')
      .select('id', { count: 'exact', head: true })
      .eq('city', city);
    if (error || count == null) throw new Error(`contar ${city}: ${error?.message ?? 'count null'}`);
    counts.set(city, count);
  }

  console.log(`\n━━ 1. Ciudades con guion: ${counts.size} valores distintos ━━`);
  let slugRows = 0;
  for (const [oldCity, n] of [...counts].sort((a, b) => b[1] - a[1])) {
    const newCity = canonicalCity(oldCity);
    if (!newCity || newCity === oldCity) continue;
    slugRows += n;
    console.log(`  ${oldCity} → ${newCity} (${n})`);
    if (apply) {
      const { error } = await sb.from('properties').update({ city: newCity }).eq('city', oldCity);
      if (error) throw new Error(`update ${oldCity}: ${error.message}`);
    }
  }

  // ── 2. Puerto Colombia ───────────────────────────────────────────────────
  // Solo las que el slug confirma: una fila con city="Colombia" que NO venga
  // de "...-puerto-colombia/" podría ser el municipio de Huila de verdad.
  const hoods = new Map<string, number>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from('properties')
      .select('neighborhood')
      .eq('city', 'Colombia')
      .like('source_url', '%-puerto-colombia/%')
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`leer Puerto Colombia: ${error.message}`);
    if (!data?.length) break;
    for (const r of data) {
      const k = r.neighborhood ?? '';
      hoods.set(k, (hoods.get(k) ?? 0) + 1);
    }
    if (data.length < PAGE) break;
  }

  let pcRows = 0;
  console.log(`\n━━ 2. Puerto Colombia ━━`);
  for (const [oldHood, n] of hoods) {
    const stripped = oldHood.replace(/\s*Puerto$/i, '').trim();
    // "Puerto Colombia Puerto" viene de un slug que repite la ciudad: no es barrio.
    const newHood = stripped && stripped.toLowerCase() !== 'puerto colombia' ? stripped : null;
    pcRows += n;
    console.log(`  barrio "${oldHood}" → ${newHood ? `"${newHood}"` : 'null'} (${n})`);
    if (apply) {
      let q = sb
        .from('properties')
        .update({ city: 'Puerto Colombia', neighborhood: newHood })
        .eq('city', 'Colombia')
        .like('source_url', '%-puerto-colombia/%');
      q = oldHood ? q.eq('neighborhood', oldHood) : q.is('neighborhood', null);
      const { error } = await q;
      if (error) throw new Error(`update Puerto Colombia "${oldHood}": ${error.message}`);
    }
  }

  console.log(
    `\n${apply ? '✅ Actualizadas' : 'Se actualizarían'}: ${slugRows} filas (guion) + ${pcRows} (Puerto Colombia)`
  );
}

main().catch((err) => {
  console.error('❌', err.message ?? err);
  process.exit(1);
});
