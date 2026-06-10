// scripts/properties-by-source.ts
// Resumen de properties por source_portal (total, no-duplicados, último scrape).
// Run: npx tsx scripts/properties-by-source.ts

import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });

// Cuenta exacta robusta: reintenta y FALLA fuerte si el count viene null/error,
// en vez de coercer a 0 en silencio. Un 0 falso (count-exact transitoriamente
// fallido sobre el portal más grande) hacía leer "unique=0" como si fuera data
// — ver reporte 2026-06-10. `build` es un thunk para reconstruir el query en
// cada reintento.
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
  const rows: Array<{
    source: string;
    total: number;
    unique: number;
    duplicates: number;
    last_seen: string | null;
  }> = [];

  for (const s of sources) {
    // Secuencial (no Promise.all): evita saturar la DB con count-exact
    // concurrentes, que era lo que hacía fallar el conteo del portal grande.
    const total = await exactCount(`${s}.total`, () =>
      sb.from('properties').select('id', { count: 'exact', head: true }).eq('source_portal', s)
    );
    const unique = await exactCount(`${s}.unique`, () =>
      sb
        .from('properties')
        .select('id', { count: 'exact', head: true })
        .eq('source_portal', s)
        .eq('is_duplicate', false)
    );
    const { data: latest } = await sb
      .from('properties')
      .select('created_at')
      .eq('source_portal', s)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    rows.push({
      source: s,
      total,
      unique,
      duplicates: total - unique,
      last_seen: (latest?.created_at as string) ?? null,
    });
  }

  // Totales globales
  const grandTotal = rows.reduce((a, r) => a + r.total, 0);
  const grandUnique = rows.reduce((a, r) => a + r.unique, 0);

  console.log(`\nProperties by source — ${new Date().toISOString().slice(0, 10)}\n`);
  console.table(
    rows.map((r) => ({
      source: r.source,
      total: r.total.toLocaleString('es-CO'),
      unique: r.unique.toLocaleString('es-CO'),
      duplicates: r.duplicates.toLocaleString('es-CO'),
      last_seen: r.last_seen ? r.last_seen.slice(0, 19).replace('T', ' ') : '—',
    }))
  );
  console.log(
    `Total:  ${grandTotal.toLocaleString('es-CO')} rows · ${grandUnique.toLocaleString('es-CO')} unique\n`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
