// scripts/diag-duplicates.ts
// Auditoría del estado de deduplicación cross-portal.
// Pagina toda la tabla properties (campos mínimos) y agrupa por dedup_hash
// para detectar: (a) duplicados marcados por portal, (b) colisiones DENTRO
// del mismo portal que el dedup nunca toca (intra-portal), (c) grupos
// cross-portal con >1 fila "canónica" (dedup perdido por race/orden), y
// (d) hashes nulos. Termina con una muestra de grupos para ojear calidad.
//
// Run: npx tsx scripts/diag-duplicates.ts
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });

type Row = {
  id: string;
  source_portal: string;
  dedup_hash: string | null;
  is_duplicate: boolean;
  canonical_id: string | null;
  city: string | null;
  neighborhood: string | null;
  property_type: string | null;
  listing_type: string | null;
  price_cop: number | null;
  source_url: string | null;
};

async function main() {
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  // ─── Paginación completa ───────────────────────────────────────────────
  const PAGE = 1000;
  let from = 0;
  const all: Row[] = [];
  for (;;) {
    const { data, error } = await sb
      .from('properties')
      .select(
        'id,source_portal,dedup_hash,is_duplicate,canonical_id,city,neighborhood,property_type,listing_type,price_cop,source_url'
      )
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as Row[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  console.log(`Filas leídas: ${all.length.toLocaleString('es-CO')}\n`);

  // ─── Marcado por portal ────────────────────────────────────────────────
  const byPortal = new Map<string, { total: number; dup: number; nullHash: number }>();
  for (const r of all) {
    const e = byPortal.get(r.source_portal) ?? { total: 0, dup: 0, nullHash: 0 };
    e.total++;
    if (r.is_duplicate) e.dup++;
    if (!r.dedup_hash) e.nullHash++;
    byPortal.set(r.source_portal, e);
  }
  console.log('━━ Marcado is_duplicate por portal ━━');
  console.table(
    [...byPortal.entries()].map(([portal, e]) => ({
      portal,
      total: e.total,
      duplicados: e.dup,
      '% dup': ((e.dup / e.total) * 100).toFixed(1),
      hash_null: e.nullHash,
    }))
  );

  // ─── Agrupar por hash ──────────────────────────────────────────────────
  const groups = new Map<string, Row[]>();
  for (const r of all) {
    if (!r.dedup_hash) continue;
    const g = groups.get(r.dedup_hash) ?? [];
    g.push(r);
    groups.set(r.dedup_hash, g);
  }

  let intraPortalExtra = 0; // filas no marcadas que comparten hash+portal
  let intraPortalGroups = 0;
  let missedCrossGroups = 0; // grupos cross-portal con >=2 canónicas
  let missedCrossExtra = 0; // canónicas "de más" en esos grupos
  const intraSamples: Row[][] = [];
  const missedSamples: Row[][] = [];

  for (const g of groups.values()) {
    if (g.length < 2) continue;

    // Intra-portal: por portal, cuántas filas comparten el hash.
    const perPortal = new Map<string, Row[]>();
    for (const r of g) {
      const arr = perPortal.get(r.source_portal) ?? [];
      arr.push(r);
      perPortal.set(r.source_portal, arr);
    }
    for (const arr of perPortal.values()) {
      if (arr.length > 1) {
        intraPortalGroups++;
        intraPortalExtra += arr.length - 1;
        if (intraSamples.length < 5) intraSamples.push(arr);
      }
    }

    // Cross-portal: si el grupo abarca >=2 portales, ¿cuántas filas no-dup
    // (canónicas) quedaron? Idealmente 1. >1 = dedup perdido.
    const portals = new Set(g.map((r) => r.source_portal));
    if (portals.size >= 2) {
      const canon = g.filter((r) => !r.is_duplicate);
      if (canon.length >= 2) {
        missedCrossGroups++;
        missedCrossExtra += canon.length - 1;
        if (missedSamples.length < 5) missedSamples.push(canon);
      }
    }
  }

  console.log('\n━━ Colisiones INTRA-portal (mismo hash, mismo portal — el dedup nunca las toca) ━━');
  console.log(`  Grupos: ${intraPortalGroups.toLocaleString('es-CO')}`);
  console.log(`  Filas "extra" (potencialmente la misma propiedad re-listada): ${intraPortalExtra.toLocaleString('es-CO')}`);

  console.log('\n━━ Dedup cross-portal PERDIDO (>=2 portales, >=2 canónicas) ━━');
  console.log(`  Grupos: ${missedCrossGroups.toLocaleString('es-CO')}`);
  console.log(`  Canónicas redundantes (deberían ser duplicados): ${missedCrossExtra.toLocaleString('es-CO')}`);

  // ─── Muestras ──────────────────────────────────────────────────────────
  const fmt = (r: Row) =>
    `    [${r.source_portal}] ${r.city ?? '?'}/${r.neighborhood ?? '?'} · ${r.property_type}/${r.listing_type} · $${(r.price_cop ?? 0).toLocaleString('es-CO')} · dup=${r.is_duplicate} · ${r.source_url ?? ''}`;

  if (intraSamples.length) {
    console.log('\n── Muestra colisiones intra-portal ──');
    intraSamples.forEach((g, i) => {
      console.log(`  Grupo ${i + 1} (hash ${g[0].dedup_hash}):`);
      g.forEach((r) => console.log(fmt(r)));
    });
  }
  if (missedSamples.length) {
    console.log('\n── Muestra dedup cross-portal perdido ──');
    missedSamples.forEach((g, i) => {
      console.log(`  Grupo ${i + 1} (hash ${g[0].dedup_hash}):`);
      g.forEach((r) => console.log(fmt(r)));
    });
  }

  // ─── Calidad de matches confirmados: muestra de duplicados marcados ─────
  const confirmed = all.filter((r) => r.is_duplicate && r.canonical_id);
  console.log(`\n━━ Duplicados marcados (is_duplicate=true): ${confirmed.length.toLocaleString('es-CO')} ━━`);
  const canonById = new Map(all.map((r) => [r.id, r]));
  console.log('\n── Muestra de 8 pares duplicado→canónico ──');
  for (const d of confirmed.slice(0, 8)) {
    const c = canonById.get(d.canonical_id!);
    console.log(`  DUP ${fmt(d).trim()}`);
    console.log(`  CAN ${c ? fmt(c).trim() : '(canónico no encontrado — id ' + d.canonical_id + ')'}`);
    console.log('');
  }

  // Duplicados huérfanos: canonical_id apunta a fila inexistente.
  const orphans = confirmed.filter((d) => !canonById.has(d.canonical_id!));
  console.log(`Duplicados huérfanos (canonical_id roto): ${orphans.length.toLocaleString('es-CO')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
