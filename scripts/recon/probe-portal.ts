// scripts/recon/probe-portal.ts
// Recon manual contra portales. Mide threshold de rate-limit con UA realista
// (no BuscaProp). Empieza lento, baja gradual, para al primer 429/403.
//
// Uso: npx tsx scripts/recon/probe-portal.ts <portal>
//   donde <portal> ∈ ciencuadras|fincaraiz|metrocuadrado|properati
//
// IMPORTANTE: NO usar UA "BuscaProp" — la idea es ver qué tolera el portal
// con tráfico que parece browser real. Si nuestro scraper recibe peor
// trato, eso prueba que el problema es el UA, no el rate.

export {}; // mark as module to avoid global symbol collision with sibling scripts
const REALISTIC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const BROWSER_HEADERS = {
  'User-Agent': REALISTIC_UA,
  'Accept':
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'es-CO,es;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br, zstd',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="131", "Google Chrome";v="131"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"macOS"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
};

interface PortalConfig {
  name: string;
  // URLs para probar — homepage + 1 listing detail real
  urls: string[];
}

const PORTALS: Record<string, PortalConfig> = {
  ciencuadras: {
    name: 'Ciencuadras',
    urls: [
      'https://www.ciencuadras.com/',
      'https://www.ciencuadras.com/sitemap.xml',
      'https://www.ciencuadras.com/arriendo-apartamentos-bogota',
    ],
  },
  fincaraiz: {
    name: 'Fincaraíz',
    urls: [
      'https://www.fincaraiz.com.co/',
      'https://www.fincaraiz.com.co/sitemap.xml',
      'https://www.fincaraiz.com.co/finca-raiz/apartamentos/arriendo/bogota',
    ],
  },
  metrocuadrado: {
    name: 'Metrocuadrado',
    urls: [
      'https://www.metrocuadrado.com/',
      'https://www.metrocuadrado.com/sitemap.xml',
      'https://www.metrocuadrado.com/apartamento/arriendo/bogota',
    ],
  },
  properati: {
    name: 'Properati',
    urls: [
      'https://www.properati.com.co/',
      'https://www.properati.com.co/sitemap.xml',
      'https://www.properati.com.co/s/bogota/arriendo',
    ],
  },
};

interface ProbeResult {
  url: string;
  status: number;
  ms: number;
  bytes: number;
  cfRay?: string;
  server?: string;
  rateLimit?: string;
  setCookie?: string;
  retryAfter?: string;
  blocked: boolean;
}

async function probe(url: string): Promise<ProbeResult> {
  const t0 = Date.now();
  let status = 0;
  let bytes = 0;
  let headers: Headers | null = null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    const res = await fetch(url, {
      headers: BROWSER_HEADERS,
      redirect: 'follow',
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    status = res.status;
    headers = res.headers;
    const txt = await res.text();
    bytes = txt.length;
  } catch (e) {
    return {
      url,
      status: -1,
      ms: Date.now() - t0,
      bytes: 0,
      blocked: true,
    };
  }
  const ms = Date.now() - t0;
  const blocked = status === 403 || status === 429 || status >= 500;
  return {
    url,
    status,
    ms,
    bytes,
    cfRay: headers?.get('cf-ray') ?? undefined,
    server: headers?.get('server') ?? undefined,
    rateLimit:
      headers?.get('ratelimit-remaining') ??
      headers?.get('x-ratelimit-remaining') ??
      undefined,
    setCookie: headers?.get('set-cookie')?.slice(0, 80) ?? undefined,
    retryAfter: headers?.get('retry-after') ?? undefined,
    blocked,
  };
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runProbe(portalKey: string) {
  const portal = PORTALS[portalKey];
  if (!portal) {
    console.error(`Portal desconocido: ${portalKey}. Opciones: ${Object.keys(PORTALS).join(', ')}`);
    process.exit(1);
  }

  console.log(`\n=== ${portal.name} probe ===`);
  console.log(`UA: realistic Chrome 131 on macOS\n`);

  // Phase 1: baseline — 1 request por URL (ver si funciona en absoluto)
  console.log('--- Phase 1: baseline (3 requests, 5s entre cada uno) ---');
  for (const url of portal.urls) {
    const r = await probe(url);
    logRow(r, '5s');
    if (r.blocked) {
      console.log(`\n🚨 Portal bloqueado en baseline. NO continúo.`);
      return;
    }
    await sleep(5000);
  }

  // Phase 2: faster — 1s delay, 6 reqs
  console.log('\n--- Phase 2: 1s delay, 6 reqs ---');
  let blocked2 = 0;
  for (let i = 0; i < 6; i++) {
    const url = portal.urls[i % portal.urls.length];
    const r = await probe(url);
    logRow(r, '1s', `#${i + 1}`);
    if (r.blocked) {
      blocked2++;
      if (blocked2 >= 2) {
        console.log('\n🚨 2 bloqueos en phase 2 → stop.');
        return;
      }
    }
    await sleep(1000);
  }

  // Phase 3: aggressive — 0.3s delay, 6 reqs
  console.log('\n--- Phase 3: 300ms delay, 6 reqs (test threshold) ---');
  let blocked3 = 0;
  for (let i = 0; i < 6; i++) {
    const url = portal.urls[i % portal.urls.length];
    const r = await probe(url);
    logRow(r, '300ms', `#${i + 1}`);
    if (r.blocked) {
      blocked3++;
      if (blocked3 >= 2) {
        console.log('\n🚨 2 bloqueos en phase 3 → stop.');
        return;
      }
    }
    await sleep(300);
  }

  console.log('\n✅ Probe completo sin bloqueos. Portal tolera 300ms delay desde un browser realista.');
}

function logRow(r: ProbeResult, delayLabel: string, label = '') {
  const flag = r.blocked ? '🚨' : '✓';
  const cf = r.cfRay ? ` cf-ray=${r.cfRay.slice(0, 8)}…` : '';
  const srv = r.server ? ` srv=${r.server}` : '';
  const ra = r.retryAfter ? ` retry-after=${r.retryAfter}` : '';
  const rl = r.rateLimit ? ` rate-rem=${r.rateLimit}` : '';
  console.log(
    `${flag} [${delayLabel}${label ? ' ' + label : ''}] ${r.status} · ${r.ms}ms · ${r.bytes}b${cf}${srv}${ra}${rl}  ${r.url.slice(0, 60)}`
  );
}

const portalArg = process.argv[2];
if (!portalArg) {
  console.log('Uso: npx tsx scripts/recon/probe-portal.ts <portal>');
  console.log(`Opciones: ${Object.keys(PORTALS).join(', ')}`);
  process.exit(1);
}
runProbe(portalArg);
