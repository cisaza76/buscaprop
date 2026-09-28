// scripts/sweep-availability.ts
// Barrido periódico de disponibilidad: recorre el inventario activo y marca
// is_active=false lo que el portal ya retiró. Lo corre
// .github/workflows/availability-sweep.yml cada 6h.
//
// Por qué (2026-09-27): de 24 avisos de una búsqueda en Rosales, 17 ya estaban
// retirados. El chat verifica en vivo antes de mostrar, pero el dashboard no
// puede — este barrido es lo que lo mantiene limpio.
//
// Cola: por portal, primero arriendos verificados hace >3 días (rotan en días),
// después ventas verificadas hace >10 días; NULL (nunca verificado) primero.
// Un worker por portal en paralelo, cada uno secuencial con pausa — mismo
// ritmo que el cron de scraping. Señales de retiro: lib/scrapers/shared/liveness.ts.
//
// Uso:
//   npx tsx scripts/sweep-availability.ts                   # 40 min de presupuesto
//   npx tsx scripts/sweep-availability.ts --minutes 5 --dry-run
//
// Sale ≠0 si algún portal cortó por bloqueo (el workflow queda en rojo y el
// health check lo ve en scrape_attempts), o si la columna de la migración 022
// no existe — ruidoso a propósito, no en silencio.

import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });

const RECHECK_DAYS = { arriendo: 3, venta: 10 } as const;
const DELAY_MS = 1500;
const PAGE = 200;
const MAX_CONSECUTIVE_BLOCKS = 3;
const BLOCK_CODES = new Set([401, 403, 407, 429]);

function parseArgs(argv: string[]) {
  const a = { minutes: 40, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--minutes') a.minutes = parseFloat(argv[++i]);
    else if (argv[i] === '--dry-run') a.dryRun = true;
  }
  if (!Number.isFinite(a.minutes) || a.minutes <= 0) throw new Error('--minutes inválido');
  return a;
}

interface PortalStats {
  checked: number;
  live: number;
  gone: number;
  unknown: number;
  blocked: boolean;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { createClient } = await import('@supabase/supabase-js');
  const { normalizeSupabaseUrl } = await import('../lib/supabase-url');
  const { checkListingLiveDetailed } = await import('../lib/scrapers/shared/liveness');
  const { recordAttempt, classifyStatus } = await import('../lib/scrapers/shared/metrics');
  const sb = createClient(
    normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL!),
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
  const deadline = Date.now() + args.minutes * 60_000;

  // Portales activos: los mismos que audita el health check (migración 020).
  const { data: cursors, error: curErr } = await sb
    .from('scraper_cursor')
    .select('portal')
    .eq('active', true);
  if (curErr) throw new Error(`leer scraper_cursor: ${curErr.message}`);
  const portals = (cursors ?? []).map((c) => c.portal as string);
  if (!portals.length) throw new Error('scraper_cursor sin portales activos');

  async function nextBatch(portal: string, exclude: Set<string>) {
    for (const op of ['arriendo', 'venta'] as const) {
      const cutoff = new Date(Date.now() - RECHECK_DAYS[op] * 86_400_000).toISOString();
      const { data, error } = await sb
        .from('properties')
        .select('id, source_url')
        .eq('source_portal', portal)
        .eq('listing_type', op)
        .eq('is_active', true)
        .eq('is_duplicate', false)
        .or(`availability_checked_at.is.null,availability_checked_at.lt.${cutoff}`)
        .order('availability_checked_at', { ascending: true, nullsFirst: true })
        .limit(PAGE);
      if (error) {
        const hint = /availability_checked_at/.test(error.message)
          ? ' — falta aplicar supabase/migrations/022_properties_availability_checked_at.sql'
          : '';
        throw new Error(`cola ${portal}/${op}: ${error.message}${hint}`);
      }
      // En dry-run nada se marca, así que la cola devuelve lo mismo: excluir
      // lo ya visto en esta corrida.
      const rows = (data ?? []).filter((r) => !exclude.has(r.id));
      if (rows.length) return rows as { id: string; source_url: string }[];
    }
    return [];
  }

  async function mark(ids: string[], patch: Record<string, unknown>) {
    if (args.dryRun || !ids.length) return;
    const { error } = await sb.from('properties').update(patch).in('id', ids);
    if (error) throw new Error(`update: ${error.message}`);
  }

  async function worker(portal: string): Promise<PortalStats> {
    const st: PortalStats = { checked: 0, live: 0, gone: 0, unknown: 0, blocked: false };
    const seen = new Set<string>();
    let blocks = 0;
    while (Date.now() < deadline) {
      const batch = await nextBatch(portal, seen);
      if (!batch.length) break; // cola al día
      const liveIds: string[] = [];
      const goneIds: string[] = [];
      for (const row of batch) {
        if (Date.now() >= deadline) break;
        seen.add(row.id);
        const t0 = Date.now();
        const { verdict, status } = await checkListingLiveDetailed(row.source_url);
        recordAttempt({
          portal,
          host: new URL(row.source_url).host,
          url: row.source_url,
          status_code: status,
          response_ms: Date.now() - t0,
          bytes: null,
          ua: null,
          attempt: 1,
          error_kind: classifyStatus(status),
          // Veredicto etiquetado: check-scraper-health cuenta sweep:gone /
          // sweep:* por portal en 24h para detectar un clasificador ciego o un
          // barrido parado. Va acá y no en properties porque scrape_attempts
          // tiene índice (portal, created_at); contar en properties por
          // availability_checked_at es un seq scan que da timeout.
          error_message: `sweep:${verdict}`,
        });
        st.checked++;
        if (verdict === 'live') {
          st.live++;
          liveIds.push(row.id);
        } else if (verdict === 'gone') {
          st.gone++;
          goneIds.push(row.id);
        } else {
          // Sin veredicto: no se toca availability_checked_at, vuelve en la
          // próxima corrida.
          st.unknown++;
        }
        blocks = status != null && BLOCK_CODES.has(status) ? blocks + 1 : 0;
        if (blocks >= MAX_CONSECUTIVE_BLOCKS) {
          console.error(`🛑 ${portal}: ${blocks} bloqueos seguidos (HTTP ${status}) — corto este portal`);
          st.blocked = true;
          break;
        }
        await new Promise((r) => setTimeout(r, DELAY_MS + Math.floor(Math.random() * 500)));
      }
      const now = new Date().toISOString();
      await mark(liveIds, { availability_checked_at: now });
      await mark(goneIds, { availability_checked_at: now, is_active: false });
      if (st.blocked) break;
      if (st.checked % 200 < batch.length) {
        console.log(`  ${portal}: ${JSON.stringify(st)}`);
      }
    }
    return st;
  }

  console.log(
    `${args.dryRun ? '🔍 DRY RUN' : '✍️  APPLY'} — ${args.minutes} min, portales: ${portals.join(', ')}`
  );
  const results = await Promise.all(portals.map(async (p) => [p, await worker(p)] as const));

  console.log('\n━━ Resultado ━━');
  for (const [p, st] of results) {
    const pct = st.checked ? ((st.gone / st.checked) * 100).toFixed(1) : '0.0';
    console.log(
      `  ${st.blocked ? '🔴' : '✅'} ${p}: ${st.checked} verificados — ${st.live} vivos, ${st.gone} retirados (${pct}%), ${st.unknown} sin veredicto`
    );
  }
  if (results.some(([, st]) => st.blocked)) process.exit(1);
}

main().catch((err) => {
  console.error('❌', err.message ?? err);
  process.exit(1);
});
