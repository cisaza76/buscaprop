// scripts/audit-city-casing.ts
// Audit completo de casing/duplicados en city + neighborhood. Pull todas las
// rows no-duplicadas, normaliza, y reporta:
//   1. Ciudades únicas con conteo, ordenadas por count desc
//   2. Casos de "casing twin" — misma ciudad escrita distinto (envigado vs Envigado)
//   3. Casos de "alias twin" — Cartagena vs Cartagena de Indias
//   4. Top barrios con casing inconsistente

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
config({ path: '.env.local' });

interface Row {
  city: string | null;
  neighborhood: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function pullAll(sb: any): Promise<Row[]> {
  const all: Row[] = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await sb
      .from('properties')
      .select('city, neighborhood')
      .eq('is_duplicate', false)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as Row[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

function casefold(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const rows = await pullAll(sb);
  console.log(`Total rows analyzed: ${rows.length.toLocaleString('es-CO')}\n`);

  // === 1. Cities exactas, top 30 ===
  const cityExact = new Map<string, number>();
  for (const r of rows) {
    const c = r.city ?? '(null)';
    cityExact.set(c, (cityExact.get(c) ?? 0) + 1);
  }
  console.log('Top 30 ciudades (string exacto):');
  console.table(
    [...cityExact.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([city, n]) => ({ city, n }))
  );

  // === 2. Casing twins: distintas variantes con misma forma normalizada ===
  const byCasefold = new Map<string, Map<string, number>>();
  for (const [c, n] of cityExact) {
    if (c === '(null)') continue;
    const key = casefold(c);
    const variants = byCasefold.get(key) ?? new Map();
    variants.set(c, n);
    byCasefold.set(key, variants);
  }
  const casingTwins = [...byCasefold.entries()]
    .filter(([, v]) => v.size > 1)
    .map(([key, variants]) => ({
      normalized: key,
      variants: [...variants.entries()].map(([k, n]) => `${k} (${n})`).join(' | '),
      total: [...variants.values()].reduce((a, b) => a + b, 0),
    }));
  console.log('\n=== Casing twins (misma ciudad, distinto casing/acento) ===');
  if (casingTwins.length === 0) console.log('(ninguno)');
  else console.table(casingTwins);

  // === 3. "Cartagena" alias detection (Cartagena vs Cartagena de Indias) ===
  console.log('\n=== Alias twins detectados manualmente ===');
  const alias = (c: string) => {
    const k = casefold(c);
    if (k.startsWith('cartagena')) return 'Cartagena';
    if (k.startsWith('santiago de cali') || k === 'cali') return 'Cali';
    if (k.startsWith('santa marta') || k === 'santa marta') return 'Santa Marta';
    if (k.startsWith('santafe de bogota') || k === 'bogota') return 'Bogotá';
    return null;
  };
  const aliasGroups = new Map<string, Map<string, number>>();
  for (const [c, n] of cityExact) {
    const a = alias(c);
    if (!a) continue;
    const g = aliasGroups.get(a) ?? new Map();
    g.set(c, n);
    aliasGroups.set(a, g);
  }
  for (const [canonical, variants] of aliasGroups) {
    if (variants.size <= 1) continue;
    console.log(`${canonical}:`);
    for (const [v, n] of variants) console.log(`   ${v} → ${n}`);
  }

  // === 4. Lowercase-only candidates (probablemente sin normalizar) ===
  console.log('\n=== Cities en lowercase puro (probable bug de scraper) ===');
  const lowercase = [...cityExact.entries()]
    .filter(([c]) => c !== '(null)' && c === c.toLowerCase() && c.length > 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25);
  console.table(lowercase.map(([city, n]) => ({ city, n })));

  // === 5. Conteos: cuántas rows están afectadas en total ===
  const affectedByCasing = casingTwins.reduce((acc, t) => acc + t.total, 0);
  const affectedByAlias = [...aliasGroups.values()]
    .filter((v) => v.size > 1)
    .reduce((acc, v) => acc + [...v.values()].reduce((a, b) => a + b, 0), 0);
  const affectedByLowercase = lowercase.reduce((acc, [, n]) => acc + n, 0);

  console.log('\n=== Resumen impacto ===');
  console.table([
    { issue: 'Casing twins', rows_affected: affectedByCasing },
    { issue: 'Alias twins (Cartagena, etc.)', rows_affected: affectedByAlias },
    { issue: 'Cities en lowercase puro', rows_affected: affectedByLowercase },
  ]);
}

main();
