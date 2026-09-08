// scripts/backfill-is-active.ts
// Backfill puntual de `properties.is_active` (migración 021): marca inactivas
// las propiedades que ningún scraper vio en los últimos N días (default 90).
//
// Uso:
//   npx tsx scripts/backfill-is-active.ts              # DRY RUN — no escribe
//   npx tsx scripts/backfill-is-active.ts --apply      # escribe
//   npx tsx scripts/backfill-is-active.ts --days 120   # otro umbral
//
// Por qué 90 días y no menos: la cadencia real de revisita lo exige. Medido el
// 2026-08-18, el 88% del inventario llevaba >7d sin revisitarse, 61% >30d y
// 33% >60d. Un umbral agresivo escondería catálogo vivo — que es EL modo de
// fallo que importa acá. A 90 días queda ~8,8%: propiedades que no aparecieron
// en un ciclo completo de crawling, que es lo que "no disponible" debería
// significar.
//
// El script mide el conteo de resultados de búsqueda ANTES y DESPUÉS. Una
// caída materialmente mayor a la esperada significa que algo está mal, y se
// revierte con un UPDATE — la columna no borra nada:
//   update properties set is_active = true where is_active = false;

import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });

const PAGE = 1000;

interface Args {
  apply: boolean;
  days: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, days: 90 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--apply') args.apply = true;
    else if (argv[i] === '--days') args.days = parseInt(argv[++i], 10);
  }
  if (!Number.isFinite(args.days) || args.days < 1) {
    throw new Error('--days debe ser un entero positivo');
  }
  return args;
}

/**
 * Un error de PostgREST legible. Con `head: true` NO hay cuerpo que parsear,
 * así que `error.message` llega VACÍO y solo queda el status — un throw con
 * mensaje en blanco es indiagnosticable. Ante 400 sin cuerpo, el sospechoso
 * número uno es la columna que no existe todavía.
 */
function describeError(error: any, status?: number): string {
  const parts = [error?.message, error?.details, error?.hint, error?.code].filter(Boolean);
  if (parts.length) return `${parts.join(' | ')}${status ? ` (HTTP ${status})` : ''}`;
  if (status === 400) {
    return 'HTTP 400 sin cuerpo — lo más probable: falta aplicar la migración 021 (columna is_active)';
  }
  return `HTTP ${status ?? '?'} sin detalle`;
}

/** Count exacto que FALLA fuerte en vez de coercer a 0 — un 0 falso acá se
 *  leería como "no hay nada que hacer" y el backfill parecería exitoso. */
async function exactCount(label: string, build: () => any): Promise<number> {
  const { count, error, status } = await build();
  if (error) throw new Error(`count(${label}) falló: ${describeError(error, status)}`);
  if (count == null) throw new Error(`count(${label}) devolvió null (HTTP ${status ?? '?'})`);
  return count as number;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const cutoff = new Date(Date.now() - args.days * 864e5).toISOString();
  console.log(`\nBackfill is_active — umbral ${args.days} días (corte: ${cutoff.slice(0, 10)})`);
  console.log(args.apply ? '⚠️  MODO APPLY — va a escribir\n' : '🔍 DRY RUN — no escribe nada\n');

  // ── Antes ────────────────────────────────────────────────────────────────
  const visibleBefore = await exactCount('visible.before', () =>
    sb
      .from('properties')
      .select('id', { count: 'exact', head: true })
      .eq('is_duplicate', false)
      .eq('is_active', true)
  );
  const candidates = await exactCount('candidatas', () =>
    sb
      .from('properties')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true)
      .lt('scraped_at', cutoff)
  );

  const pct = visibleBefore > 0 ? (100 * candidates) / visibleBefore : 0;
  console.log(`  Visibles en búsqueda ahora: ${visibleBefore.toLocaleString('es-CO')}`);
  console.log(
    `  A marcar inactivas:         ${candidates.toLocaleString('es-CO')} (${pct.toFixed(1)}% del visible)`
  );

  if (candidates === 0) {
    console.log('\nNada que hacer.');
    return;
  }

  // Guardarraíl: el modo de fallo que importa es esconder inventario bueno.
  // 25% es holgado contra el 8,8% esperado, y aun así corta un desastre.
  const MAX_SAFE_PCT = 25;
  if (pct > MAX_SAFE_PCT) {
    console.error(
      `\n❌ ABORTA: marcaría el ${pct.toFixed(1)}% del inventario visible (tope ${MAX_SAFE_PCT}%).`
    );
    console.error('   Esperado ~8,8% a 90 días. Una cifra así de alta significa que algo está mal:');
    console.error('   revisar si el crawling está corriendo antes de esconder catálogo.');
    process.exit(1);
  }

  if (!args.apply) {
    console.log(`\n  Visible después (proyectado): ${(visibleBefore - candidates).toLocaleString('es-CO')}`);
    console.log('\nDry run — nada escrito. Para aplicar: --apply');
    return;
  }

  // ── Aplicar ──────────────────────────────────────────────────────────────
  // Por páginas de ids y no un UPDATE masivo: PostgREST corta en 1000 filas sin
  // avisar, y un update sin tope sobre ~23k filas es un lock largo en la tabla
  // más caliente del producto.
  let marked = 0;
  for (;;) {
    const { data: page, error: selErr, status: selStatus } = await sb
      .from('properties')
      .select('id')
      .eq('is_active', true)
      .lt('scraped_at', cutoff)
      .order('id')
      .range(0, PAGE - 1);
    if (selErr) throw new Error(`select falló: ${describeError(selErr, selStatus)}`);
    if (!page || page.length === 0) break;

    const ids = page.map((r) => (r as { id: string }).id);
    const { data: updated, error: updErr, status: updStatus } = await sb
      .from('properties')
      .update({ is_active: false })
      .in('id', ids)
      .select('id');
    if (updErr) throw new Error(`update falló: ${describeError(updErr, updStatus)}`);

    const n = updated?.length ?? 0;
    // Sin esto un update que no matchea nada daría un loop infinito: el select
    // devolvería siempre la misma página.
    if (n === 0) throw new Error('el update no afectó filas; aborto para no ciclar');
    marked += n;
    process.stdout.write(`\r  marcadas: ${marked.toLocaleString('es-CO')}`);
  }
  console.log('');

  // ── Después ──────────────────────────────────────────────────────────────
  const visibleAfter = await exactCount('visible.after', () =>
    sb
      .from('properties')
      .select('id', { count: 'exact', head: true })
      .eq('is_duplicate', false)
      .eq('is_active', true)
  );
  const drop = visibleBefore > 0 ? (100 * (visibleBefore - visibleAfter)) / visibleBefore : 0;

  console.log(`\n  Visible antes:   ${visibleBefore.toLocaleString('es-CO')}`);
  console.log(`  Visible después: ${visibleAfter.toLocaleString('es-CO')}`);
  console.log(`  Caída:           ${drop.toFixed(1)}%`);
  console.log(`\n✅ ${marked.toLocaleString('es-CO')} propiedades marcadas inactivas.`);
  console.log('   Revertir todo:  update properties set is_active = true where is_active = false;');
}

main().catch((err) => {
  console.error('\n❌', err instanceof Error ? err.message : err);
  process.exit(1);
});
