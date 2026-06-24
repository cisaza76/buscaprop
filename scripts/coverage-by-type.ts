// scripts/coverage-by-type.ts
// Cobertura por property_type × source_portal (solo no-duplicados).
// Run: npx tsx scripts/coverage-by-type.ts

import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });

async function exactCount(label: string, build: () => any): Promise<number> {
  let lastErr = 'count was null';
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { count, error } = await build();
    if (!error && count != null) return count as number;
    lastErr = error?.message ?? 'count was null';
    if (attempt < 3) await new Promise((r) => setTimeout(r, 300 * attempt));
  }
  throw new Error(`exactCount(${label}) falló tras 3 intentos: ${lastErr}`);
}

async function main() {
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const sources = ['fincaraiz', 'metrocuadrado', 'properati', 'ciencuadras'];
  const types = ['apartamento', 'casa', 'oficina', 'lote'];

  // matriz tipo × fuente (unique only)
  const matrix: Record<string, Record<string, number>> = {};
  for (const t of types) matrix[t] = {};

  for (const s of sources) {
    for (const t of types) {
      matrix[t][s] = await exactCount(`${s}.${t}`, () =>
        sb
          .from('properties')
          .select('id', { count: 'exact', head: true })
          .eq('source_portal', s)
          .eq('is_duplicate', false)
          .eq('property_type', t)
      );
    }
  }

  // ¿hay tipos fuera del set esperado?
  const knownByType: Record<string, number> = {};
  for (const t of types)
    knownByType[t] = sources.reduce((a, s) => a + matrix[t][s], 0);
  const totalUniqueExpected = Object.values(knownByType).reduce((a, b) => a + b, 0);
  const totalUniqueAll = await exactCount('all.unique', () =>
    sb.from('properties').select('id', { count: 'exact', head: true }).eq('is_duplicate', false)
  );
  const other = totalUniqueAll - totalUniqueExpected;

  console.log(`\nCobertura por property_type (únicos) — ${new Date().toISOString().slice(0, 10)}\n`);
  console.table(
    types.map((t) => {
      const row: Record<string, string> = { type: t };
      for (const s of sources) row[s] = matrix[t][s].toLocaleString('es-CO');
      row.TOTAL = knownByType[t].toLocaleString('es-CO');
      const pct = ((knownByType[t] / totalUniqueAll) * 100).toFixed(1);
      row['%'] = `${pct}%`;
      return row;
    })
  );
  console.log(
    `Total únicos: ${totalUniqueAll.toLocaleString('es-CO')} · tipados ${totalUniqueExpected.toLocaleString('es-CO')} · otros/null ${other.toLocaleString('es-CO')}\n`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
