// scripts/recon/compare-ua.ts
// Compara: ¿el UA "BuscaProp Colombia (+contacto@buscaprop.co)" recibe trato
// distinto al UA realista? Si ambos vuelven 200 → el UA bot NO es problema
// (al menos hoy). Si BuscaProp recibe 403/429 mientras el realista no →
// confirmación de que necesitamos rotación.

export {}; // mark as module to avoid global symbol collision with sibling scripts
const REALISTIC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const BOT_UA = 'BuscaProp Colombia (+contacto@buscaprop.co)';

const TARGETS = [
  { name: 'Ciencuadras', url: 'https://www.ciencuadras.com/arriendo-apartamentos-bogota' },
  { name: 'Fincaraíz', url: 'https://www.fincaraiz.com.co/finca-raiz/apartamentos/arriendo/bogota' },
  { name: 'Metrocuadrado', url: 'https://www.metrocuadrado.com/apartamento/arriendo/bogota' },
  { name: 'Properati', url: 'https://www.properati.com.co/' },
];

async function probe(url: string, ua: string, extraHeaders: Record<string, string> = {}) {
  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 20000);
    const res = await fetch(url, {
      headers: {
        'User-Agent': ua,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-CO,es;q=0.9,en;q=0.5',
        ...extraHeaders,
      },
      redirect: 'follow',
      signal: ctrl.signal,
    });
    const txt = await res.text();
    return {
      status: res.status,
      ms: Date.now() - t0,
      bytes: txt.length,
      cfRay: res.headers.get('cf-ray'),
      server: res.headers.get('server'),
    };
  } catch (e) {
    return { status: -1, ms: Date.now() - t0, bytes: 0, error: String(e) };
  }
}

async function main() {
  console.log('Compare UAs across 4 portals (3s entre cada par)\n');
  for (const t of TARGETS) {
    console.log(`=== ${t.name} ===`);
    const a = await probe(t.url, REALISTIC_UA);
    await new Promise((r) => setTimeout(r, 3000));
    const b = await probe(t.url, BOT_UA);
    console.log(`  realistic UA: ${a.status} · ${a.ms}ms · ${a.bytes}b`);
    console.log(`  BuscaProp UA: ${b.status} · ${b.ms}ms · ${b.bytes}b`);
    const diff = a.status !== b.status ? '🚨 DIFFERENT STATUS' : a.bytes !== b.bytes && Math.abs(a.bytes - b.bytes) > 1000 ? '⚠ different content' : '✓ equivalent';
    console.log(`  → ${diff}\n`);
    await new Promise((r) => setTimeout(r, 3000));
  }
}
main();
