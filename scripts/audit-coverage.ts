// scripts/audit-coverage.ts
// Baseline audit: cuánto inventario tiene cada portal vs cuánto tenemos en DB.
//
// Fincaraíz + Ciencuadras: sitemap traversal (exact).
// Properati: per-combo `de N resultados` extracted from search HTML (exact).
// Metrocuadrado: midinmueble IDs únicos extraídos del RSC payload por combo
// (5 ciudades + barrios × 5 tipos × 2 ops). No expone total — se aproxima
// vía dedup de IDs entre combos.
//
// Output: tabla con total_portal, db_count, coverage_pct por portal.
import './_load-env';
import { createClient } from '@supabase/supabase-js';
import { fetchXml, fetchText } from '../lib/scrapers/shared/http';
import {
  parseSitemapIndexWithLastmod,
  parseUrlSetWithLastmod,
} from '../lib/scrapers/shared/sitemap';

// ============================================================================
// Fincaraíz
// ============================================================================
const FCR_INDEX = 'https://www.fincaraiz.com.co/cde-sitemap-listings-index.xml';

async function countFincaraiz(): Promise<number> {
  console.log('[FCR] fetching sitemap index…');
  const indexXml = await fetchXml(FCR_INDEX, { portal: 'audit' });
  const children = parseSitemapIndexWithLastmod(indexXml);
  console.log(`[FCR] ${children.length} child sitemaps`);
  let total = 0;
  for (let i = 0; i < children.length; i++) {
    const c = children[i];
    try {
      const xml = await fetchXml(c.url, { portal: 'audit' });
      const entries = parseUrlSetWithLastmod(xml);
      total += entries.length;
      process.stdout.write(`  [${i + 1}/${children.length}] +${entries.length} → cum ${total}\r`);
    } catch (e) {
      console.warn(`\n[FCR] child fail ${c.url}: ${(e as Error).message}`);
    }
  }
  console.log(`\n[FCR] total listings en sitemap: ${total}`);
  return total;
}

// ============================================================================
// Ciencuadras
// ============================================================================
const CC_OP_INDEXES = [
  'https://www.ciencuadras.com/sitemap-index-detalles-inmuebles-venta.xml',
  'https://www.ciencuadras.com/sitemap-index-detalles-inmuebles-arriendo.xml',
];

async function countCiencuadras(): Promise<number> {
  let total = 0;
  for (const idx of CC_OP_INDEXES) {
    console.log(`[CC] fetching ${idx}…`);
    const xml = await fetchXml(idx, { portal: 'audit' });
    const children = parseSitemapIndexWithLastmod(xml);
    console.log(`[CC]   ${children.length} child sitemaps`);
    for (let i = 0; i < children.length; i++) {
      const c = children[i];
      try {
        const cxml = await fetchXml(c.url, { portal: 'audit' });
        const entries = parseUrlSetWithLastmod(cxml);
        total += entries.length;
        process.stdout.write(`    [${i + 1}/${children.length}] +${entries.length} → cum ${total}\r`);
      } catch (e) {
        console.warn(`\n[CC] child fail ${c.url}: ${(e as Error).message}`);
      }
    }
    console.log();
  }
  console.log(`[CC] total listings en sitemap: ${total}`);
  return total;
}

// ============================================================================
// Properati — sumar "de N resultados" por combo
// ============================================================================
const PROPERATI_BASE = 'https://www.properati.com.co';
const PROP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 BuscaProp/1.0 ' +
  '(+contacto@buscaprop.co)';
const PROP_LOCATIONS = [
  'bogota-d-c-colombia',
  'medellin-antioquia',
  'cali-valle-del-cauca',
  'barranquilla-atlantico',
  'cartagena-bolivar',
];
const PROP_TYPES = ['apartamento', 'casa', 'apartaestudio', 'oficina'];
const PROP_OPS = ['venta', 'arriendo'];

async function countProperati(): Promise<number> {
  let total = 0;
  const breakdown: Record<string, number> = {};
  const combos: Array<{ loc: string; type: string; op: string }> = [];
  for (const loc of PROP_LOCATIONS)
    for (const type of PROP_TYPES) for (const op of PROP_OPS) combos.push({ loc, type, op });

  console.log(`[Properati] ${combos.length} combos a auditar…`);
  for (let i = 0; i < combos.length; i++) {
    const c = combos[i];
    const url = `${PROPERATI_BASE}/s/${c.loc}/${c.type}/${c.op}`;
    try {
      const html = await fetchText(url, { userAgent: PROP_UA, portal: 'audit' });
      const m = html.match(/de\s+([0-9.,]+)\s+resultados/);
      const n = m ? parseInt(m[1].replace(/[.,]/g, ''), 10) : 0;
      total += n;
      const key = `${c.type}/${c.op}`;
      breakdown[key] = (breakdown[key] ?? 0) + n;
      process.stdout.write(`  [${i + 1}/${combos.length}] ${c.loc}/${c.type}/${c.op} = ${n} → cum ${total}\r`);
    } catch (e) {
      console.warn(`\n[Properati] combo fail ${url}: ${(e as Error).message}`);
    }
  }
  console.log(`\n[Properati] total listings (sum de N resultados): ${total}`);
  console.log('  breakdown por type/op:');
  for (const [k, v] of Object.entries(breakdown).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k.padEnd(28)} ${v.toLocaleString('es-CO')}`);
  }
  return total;
}

// ============================================================================
// Metrocuadrado — extraer midinmueble IDs únicos de cada combo
// ============================================================================
const M2_BASE = 'https://www.metrocuadrado.com';
const M2_CITIES = ['bogota', 'medellin', 'cali', 'barranquilla', 'cartagena'];
const M2_TYPES = ['apartamento', 'casa', 'oficina', 'lote', 'apartaestudio'];
const M2_OPS = ['venta', 'arriendo'];
const M2_BARRIOS: Record<string, string[]> = {
  bogota: [
    'rosales', 'chapinero', 'usaquen', 'chico-norte', 'cabrera', 'nogal',
    'santa-barbara', 'cedritos', 'santa-ana', 'quinta-camacho', 'salitre', 'modelia',
  ],
  medellin: [
    'poblado', 'laureles', 'envigado', 'sabaneta', 'belen',
    'conquistadores', 'los-balsos', 'las-palmas',
  ],
  cali: ['ciudad-jardin', 'el-penon', 'granada', 'san-fernando', 'valle-del-lili'],
  barranquilla: ['alto-prado', 'el-prado', 'riomar', 'villa-country'],
  cartagena: ['centro-historico', 'bocagrande', 'manga'],
};

async function countMetrocuadrado(): Promise<number> {
  const combos: Array<{ city: string; type: string; op: string; barrio?: string }> = [];
  for (const op of M2_OPS) {
    for (const type of M2_TYPES) {
      for (const city of M2_CITIES) combos.push({ city, type, op });
      for (const city of M2_CITIES) {
        for (const barrio of M2_BARRIOS[city] ?? []) combos.push({ city, type, op, barrio });
      }
    }
  }

  const uniqueIds = new Set<string>();
  const byCity: Record<string, Set<string>> = {};
  for (const city of M2_CITIES) byCity[city] = new Set();

  console.log(`[M2] ${combos.length} combos a auditar…`);
  let dupHits = 0;
  for (let i = 0; i < combos.length; i++) {
    const c = combos[i];
    const url = c.barrio
      ? `${M2_BASE}/${c.type}/${c.op}/${c.city}/${c.barrio}/`
      : `${M2_BASE}/${c.type}/${c.op}/${c.city}/`;
    try {
      const html = await fetchText(url, { portal: 'audit' });
      // En RSC payload los IDs aparecen como \"midinmueble\":\"123456\"
      const matches = html.matchAll(/midinmueble["\\:]+([0-9]+)/g);
      let comboNew = 0;
      for (const m of matches) {
        const id = m[1];
        if (uniqueIds.has(id)) dupHits++;
        else {
          uniqueIds.add(id);
          comboNew++;
        }
        byCity[c.city].add(id);
      }
      const label = c.barrio ? `${c.city}/${c.barrio}` : `${c.city}`;
      process.stdout.write(
        `  [${i + 1}/${combos.length}] ${c.type}/${c.op}/${label} +${comboNew} → uniq ${uniqueIds.size}\r`
      );
    } catch (e) {
      console.warn(`\n[M2] combo fail ${url}: ${(e as Error).message}`);
    }
  }
  console.log(
    `\n[M2] total unique IDs: ${uniqueIds.size} (dup hits during scan: ${dupHits})`
  );
  console.log('  por ciudad:');
  for (const [city, set] of Object.entries(byCity)) {
    console.log(`    ${city.padEnd(15)} ${set.size.toLocaleString('es-CO')}`);
  }
  return uniqueIds.size;
}

// ============================================================================
// DB counts
// ============================================================================
async function getDbCounts(): Promise<Record<string, number>> {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
  const result: Record<string, number> = {};
  for (const p of ['fincaraiz', 'ciencuadras', 'properati', 'metrocuadrado']) {
    const { count } = await sb
      .from('properties')
      .select('id', { count: 'exact', head: true })
      .eq('source_portal', p);
    result[p] = count ?? 0;
  }
  return result;
}

// ============================================================================
// Main
// ============================================================================
async function main() {
  const dbCounts = await getDbCounts();
  const portalSelector = process.argv[2]; // opcional: 'fcr', 'cc', 'properati'

  const totals: Record<string, number> = {};
  if (!portalSelector || portalSelector === 'fcr') totals.fincaraiz = await countFincaraiz();
  if (!portalSelector || portalSelector === 'cc') totals.ciencuadras = await countCiencuadras();
  if (!portalSelector || portalSelector === 'properati')
    totals.properati = await countProperati();
  if (!portalSelector || portalSelector === 'm2')
    totals.metrocuadrado = await countMetrocuadrado();

  console.log('\n=== Baseline coverage audit — ' + new Date().toISOString().slice(0, 10) + ' ===\n');
  const rows: Array<Record<string, string | number>> = [];
  for (const p of Object.keys(totals)) {
    const total = totals[p];
    const db = dbCounts[p];
    const pct = total > 0 ? ((db / total) * 100).toFixed(1) + '%' : 'N/A';
    rows.push({
      portal: p,
      total_portal: total.toLocaleString('es-CO'),
      db_count: db.toLocaleString('es-CO'),
      coverage: pct,
      gap: (total - db).toLocaleString('es-CO'),
    });
  }
  console.table(rows);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
