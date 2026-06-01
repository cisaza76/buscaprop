// scripts/test-fincaraiz-sitemap-order.ts
// Test unitario del orden determinista de child sitemaps (Sección 1 del
// rediseño de crawl). NO toca red — opera sobre una lista fija de URLs.
//
// Valida:
//   1. El orden es reproducible (dos llamadas seguidas → mismo resultado).
//   2. Los primeros 5 sitemaps tocan los 5 tipos (round-robin por tipo).
//   3. Si falta un tipo en un bloque, no hay gaps ni se rompe el índice.

import { orderChildSitemaps } from '../lib/scrapers/fincaraiz';

const BASE = 'https://www.fincaraiz.com.co/cde-sitemap-listings';
const DEPTS = ['bogota-dc', 'antioquia', 'valle-del-cauca', 'atlantico', 'bolivar'];
const TYPES = ['apartamento', 'casa', 'oficina', 'lote', 'apartaestudio'];
const OPS = ['venta', 'alquiler'];

function url(type: string, op: string, dept: string): string {
  return `${BASE}-${type}-en-${op}-${dept}.xml`;
}

function typeOf(u: string): string {
  return TYPES.find((t) => u.includes(`-${t}-en-`))!;
}

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    console.log(`  ✅ ${name}`);
  } else {
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
    failures++;
  }
}

console.log('='.repeat(60));
console.log('FINCARAIZ SITEMAP ORDER TEST');
console.log('='.repeat(60));

// Lista completa pero deliberadamente desordenada (simula orden arbitrario de
// llegada del XML — aquí alfabético por tipo, que es justo lo que queremos
// reordenar).
const full: string[] = [];
for (const t of [...TYPES].sort()) {
  for (const op of OPS) {
    for (const d of DEPTS) full.push(url(t, op, d));
  }
}

console.log('\n━━ 1. Reproducibilidad ━━');
const a = orderChildSitemaps(full, DEPTS);
const b = orderChildSitemaps(full, DEPTS);
check('dos llamadas seguidas dan el mismo orden', JSON.stringify(a) === JSON.stringify(b));
check('no se pierden ni duplican elementos', a.length === full.length, `${a.length} vs ${full.length}`);

console.log('\n━━ 2. Primeros 5 sitemaps tocan los 5 tipos ━━');
const first5Types = a.slice(0, 5).map(typeOf);
const uniqueFirst5 = new Set(first5Types);
check('los primeros 5 son 5 tipos distintos', uniqueFirst5.size === 5, [...first5Types].join(', '));
check(
  'orden de tipo es el fijo (no alfabético)',
  JSON.stringify(first5Types) === JSON.stringify(TYPES),
  first5Types.join(', ')
);
check(
  'el primer bloque es (venta, bogota-dc)',
  a.slice(0, 5).every((u) => u.includes('-venta-') && u.endsWith('-bogota-dc.xml'))
);

console.log('\n━━ 3. Tipo faltante → sin gaps, índice intacto ━━');
// Quitamos todos los sitemaps de 'lote' del primer bloque (venta, bogota-dc).
const missingLote = full.filter(
  (u) => !(u.includes('-lote-en-venta-') && u.endsWith('-bogota-dc.xml'))
);
const ordered = orderChildSitemaps(missingLote, DEPTS);
check('longitud = input (sort no agrega/quita)', ordered.length === missingLote.length);
check('sin entradas undefined/vacías', ordered.every((u) => typeof u === 'string' && u.length > 0));
// El primer bloque ahora tiene 4 tipos en orden apto, casa, oficina, apartaestudio.
const firstBlock = ordered.slice(0, 4).map(typeOf);
check(
  'bloque sin lote queda contiguo y en orden',
  JSON.stringify(firstBlock) === JSON.stringify(['apartamento', 'casa', 'oficina', 'apartaestudio']),
  firstBlock.join(', ')
);

console.log('\n' + '='.repeat(60));
if (failures > 0) {
  console.log(`❌ ${failures} aserción(es) fallaron`);
  process.exit(1);
}
console.log('✅ TODOS LOS TESTS PASARON');
