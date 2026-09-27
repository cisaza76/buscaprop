// scripts/backfill-sanitize-attributes.ts
// Aplica sanitizeAttributes (normalize.ts) a las filas existentes: pone NULL
// en áreas y conteos de habitaciones/baños imposibles. Mismos umbrales que el
// upsert — ver el comentario de sanitizeAttributes.
//
// Uso:
//   npx tsx scripts/backfill-sanitize-attributes.ts           # DRY RUN
//   npx tsx scripts/backfill-sanitize-attributes.ts --apply

import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });

async function main() {
  const apply = process.argv.includes('--apply');
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const rules: Array<{ label: string; set: Record<string, null>; where: (q: any) => any }> = [
    { label: 'área < 15 m² en apto/casa', set: { area_m2: null }, where: (q) => q.in('property_type', ['apartamento', 'casa']).lt('area_m2', 15) },
    { label: 'área <= 0', set: { area_m2: null }, where: (q) => q.lte('area_m2', 0) },
    { label: 'habitaciones > 30', set: { bedrooms: null }, where: (q) => q.gt('bedrooms', 30) },
    { label: 'baños > 30', set: { bathrooms: null }, where: (q) => q.gt('bathrooms', 30) },
  ];

  console.log(apply ? '\n✍️  APPLY' : '\n🔍 DRY RUN (usa --apply)');
  for (const r of rules) {
    const { count, error } = await r.where(
      sb.from('properties').select('id', { count: 'exact', head: true })
    );
    if (error || count == null) throw new Error(`contar "${r.label}": ${error?.message ?? 'null'}`);
    console.log(`  ${r.label}: ${count}`);
    if (apply && count > 0) {
      const { error: e } = await r.where(sb.from('properties').update(r.set));
      if (e) throw new Error(`update "${r.label}": ${e.message}`);
    }
  }
}

main().catch((err) => {
  console.error('❌', err.message ?? err);
  process.exit(1);
});
