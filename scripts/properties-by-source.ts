// scripts/properties-by-source.ts
// Resumen de properties por source_portal (total, no-duplicados, último scrape).
// Run: npx tsx scripts/properties-by-source.ts

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

  const sources = ['fincaraiz', 'metrocuadrado', 'properati', 'ciencuadras'];
  const rows: Array<{
    source: string;
    total: number;
    unique: number;
    duplicates: number;
    last_seen: string | null;
  }> = [];

  for (const s of sources) {
    const [{ count: total }, { count: unique }, { data: latest }] = await Promise.all([
      sb.from('properties').select('id', { count: 'exact', head: true }).eq('source_portal', s),
      sb
        .from('properties')
        .select('id', { count: 'exact', head: true })
        .eq('source_portal', s)
        .eq('is_duplicate', false),
      sb
        .from('properties')
        .select('created_at')
        .eq('source_portal', s)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    rows.push({
      source: s,
      total: total ?? 0,
      unique: unique ?? 0,
      duplicates: (total ?? 0) - (unique ?? 0),
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
