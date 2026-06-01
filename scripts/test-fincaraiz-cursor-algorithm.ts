// scripts/test-fincaraiz-cursor-algorithm.ts
// Test unitario del algoritmo de cursor con ventana CAP (Sección 2). NO toca
// red ni Supabase — opera sobre las funciones puras advanceFincaraizCursor y
// reconcileSitemapOrderVersion.
//
// Valida:
//   1. Avance de url_idx dentro de la ventana.
//   2. Rotación de sitemap cuando la ventana [C·CAP, C·CAP+CAP) se agota.
//   3. Incremento de ciclo cuando sitemap_idx envuelve el último sitemap.
//   4. Sitemap exhausto (entries < C·CAP) se salta solo.
//   5. Breadth real: con CAP=200/TICK_MAX=35, casa (sitemap 1) se alcanza pronto.
//   6. Persistence/migración: reconcile resetea en version-bump y es idempotente.

import {
  advanceFincaraizCursor,
  FINCARAIZ_CAP,
  type FincaraizCursor,
} from '../lib/scrapers/fincaraiz';
import { reconcileSitemapOrderVersion } from '../lib/inngest/cursor';

let failures = 0;
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    console.log(`  ✅ ${name}`);
  } else {
    console.log(`  ❌ ${name}\n       got:  ${g}\n       want: ${w}`);
    failures++;
  }
}
function ok(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
    failures++;
  }
}

console.log('='.repeat(60));
console.log('FINCARAIZ CURSOR ALGORITHM TEST');
console.log('='.repeat(60));

// Helper: un tick procesa hasta TICK_MAX URLs dentro de la ventana actual y
// luego avanza vía la función pura (igual que el loop de scrapeFincaraiz).
function tick(
  cur: FincaraizCursor,
  entriesLen: number,
  sitemapCount: number,
  tickMax: number,
  cap: number
): FincaraizCursor {
  const windowEnd = Math.min(cur.cycle * cap + cap, entriesLen);
  const consumed = Math.max(0, Math.min(tickMax, windowEnd - cur.url_idx));
  return advanceFincaraizCursor(cur, entriesLen, sitemapCount, consumed, cap);
}

console.log('\n━━ 1. Avance de url_idx dentro de la ventana (CAP=10) ━━');
let c: FincaraizCursor = { sitemap_idx: 0, url_idx: 0, cycle: 0 };
c = advanceFincaraizCursor(c, 100, 3, 4, 10);
eq('consumir 4 → u=4', c, { sitemap_idx: 0, url_idx: 4, cycle: 0 });
c = advanceFincaraizCursor(c, 100, 3, 4, 10);
eq('consumir 4 → u=8', c, { sitemap_idx: 0, url_idx: 8, cycle: 0 });

console.log('\n━━ 2. Rotación al agotar la ventana ━━');
c = advanceFincaraizCursor(c, 100, 3, 4, 10); // 8+4=12 ≥ windowEnd 10
eq('ventana llena → sitemap 1, u=0', c, { sitemap_idx: 1, url_idx: 0, cycle: 0 });

console.log('\n━━ 3. Incremento de ciclo al envolver el último sitemap ━━');
c = { sitemap_idx: 2, url_idx: 8, cycle: 0 }; // último sitemap (count=3)
c = advanceFincaraizCursor(c, 100, 3, 4, 10); // 12 ≥ 10 → wrap
eq('wrap → cycle 1, sitemap 0, u=cycle·CAP=10', c, { sitemap_idx: 0, url_idx: 10, cycle: 1 });
// La ventana del nuevo ciclo es [10,20):
c = advanceFincaraizCursor(c, 100, 3, 4, 10);
eq('ciclo 1 avanza dentro de [10,20) → u=14', c, { sitemap_idx: 0, url_idx: 14, cycle: 1 });

console.log('\n━━ 4. Sitemap exhausto (entries < C·CAP) se salta ━━');
// En ciclo 5 la ventana es [50,60), pero este sitemap solo tiene 30 entries.
c = { sitemap_idx: 1, url_idx: 50, cycle: 5 };
c = advanceFincaraizCursor(c, 30, 3, 0, 10); // consumed=0, ventana vacía
eq('ventana vacía → salta a sitemap 2 (mismo ciclo)', c, {
  sitemap_idx: 2,
  url_idx: 50,
  cycle: 5,
});

console.log('\n━━ 5. Breadth: CAP=200/TICK_MAX=35 alcanza casa (sitemap 1) pronto ━━');
ok('CAP de producción es 200', FINCARAIZ_CAP === 200, `es ${FINCARAIZ_CAP}`);
let p: FincaraizCursor = { sitemap_idx: 0, url_idx: 0, cycle: 0 };
let ticks = 0;
while (p.sitemap_idx === 0 && p.cycle === 0 && ticks < 100) {
  p = tick(p, 10_000, 50, 35, 200);
  ticks++;
}
ok(
  `casa (sitemap 1) alcanzada en ${ticks} ticks (≤ 6)`,
  p.sitemap_idx === 1 && ticks <= 6,
  JSON.stringify(p)
);

console.log('\n━━ 6. Persistence/migración: reconcile en version-bump ━━');
// Cursor histórico guardado con orden viejo (version 0), código en v1.
const storedV0 = {
  last_sitemap_idx: 12,
  last_url_idx: 4327,
  last_cycle: 0,
  sitemap_order_version: 0,
};
const r1 = reconcileSitemapOrderVersion(storedV0, 1);
ok('detecta desfase → didReset=true', r1.didReset);
eq('reset posición, preserva+incrementa cycle, sube versión', r1.cursor, {
  last_sitemap_idx: 0,
  last_url_idx: 0,
  last_cycle: 1,
  sitemap_order_version: 1,
});

// Round-trip: guardamos el cursor reconciliado y volvemos a cargar → idempotente.
const store = r1.cursor; // simula la fila persistida en Supabase
const r2 = reconcileSitemapOrderVersion(store, 1);
ok('segundo load no resetea (idempotente)', !r2.didReset);
eq('cursor intacto en segundo load', r2.cursor, store);

console.log('\n━━ 7. advanceFincaraizCursor con cycle>0 ━━');
// La ventana del ciclo C es [C·CAP, C·CAP+CAP). Avanzar dentro de ella NO debe
// cambiar el ciclo; agotarla en el último sitemap SÍ debe incrementarlo.
// En ambos casos output.cycle ∈ {input.cycle, input.cycle+1}.
const inCycle = 2; // cycle>0
// (a) avance dentro de la ventana [400,600) → mismo ciclo
const stay = advanceFincaraizCursor(
  { sitemap_idx: 1, url_idx: 400, cycle: inCycle },
  10_000,
  50,
  35,
  200
);
eq('cycle>0: avance dentro de ventana → mismo ciclo', stay, {
  sitemap_idx: 1,
  url_idx: 435,
  cycle: inCycle,
});
ok('output.cycle == input.cycle', stay.cycle === inCycle);
// (b) agotar ventana en el último sitemap → cycle+1
const wrap = advanceFincaraizCursor(
  { sitemap_idx: 49, url_idx: 400, cycle: inCycle },
  10_000,
  50,
  200,
  200
);
ok('output.cycle == input.cycle+1 al envolver', wrap.cycle === inCycle + 1, JSON.stringify(wrap));
ok(
  'invariante: output.cycle ∈ {input, input+1}',
  (stay.cycle === inCycle || stay.cycle === inCycle + 1) &&
    (wrap.cycle === inCycle || wrap.cycle === inCycle + 1)
);

console.log('\n' + '='.repeat(60));
if (failures > 0) {
  console.log(`❌ ${failures} aserción(es) fallaron`);
  process.exit(1);
}
console.log('✅ TODOS LOS TESTS PASARON');
