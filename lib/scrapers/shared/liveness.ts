// lib/scrapers/shared/liveness.ts
// ¿El aviso sigue publicado en el portal de origen?
//
// Por qué hace falta (2026-09-27): una búsqueda de arriendo en Rosales
// devolvió 20 propiedades y ~16 ya estaban retiradas. El scraper revisita
// cada ficha cada varias semanas y un arriendo bueno se va en días. Ninguno
// de los tres portales responde 404 a un aviso retirado:
//   - Fincaraiz: 301 a /arriendo/apartamentos?addeletedid=<id>, o 200 con
//     "la propiedad que estabas buscando no está disponible".
//   - Metrocuadrado: 200 con "Parece que este inmueble no está disponible".
//   - Ciencuadras: 200 con "Este inmueble ya no está disponible".
//
// Tres veredictos, no dos: ante un 403, un timeout o un 5xx no sabemos nada,
// y esconder un aviso vivo por un error nuestro es peor que mostrar uno
// muerto — el caller decide qué hacer con 'unknown' (hoy: mostrarlo).

export type Liveness = 'live' | 'gone' | 'unknown';

// Frases exactas de cada portal. Genéricas como "no está disponible" a secas
// darían falsos positivos con descripciones ("el parqueadero no está
// disponible los domingos").
const GONE_PHRASES = [
  /la propiedad que estabas buscando no est[aá] disponible/i, // Fincaraiz
  /parece que este inmueble no est[aá] disponible/i, // Metrocuadrado
  /este inmueble ya no est[aá] disponible/i, // Ciencuadras
];

/** Id del aviso dentro de la URL (Fincaraiz: /193897133, M2: /…-M5742999, CC: -3856524). */
function listingId(url: string): string | null {
  const path = url.replace(/[?#].*$/, '').replace(/\/+$/, '');
  return path.match(/(\d{5,})$/)?.[1] ?? null;
}

export function classifyListingPage(r: {
  url: string;
  status: number | null;
  location?: string | null;
  html?: string;
}): Liveness {
  if (r.status === 404 || r.status === 410) return 'gone';
  if (r.status != null && r.status >= 300 && r.status < 400) {
    const loc = r.location ?? '';
    if (/addeletedid=/i.test(loc)) return 'gone';
    const id = listingId(r.url);
    // Redirect a una URL que ya no lleva el id: el portal nos manda a otra
    // cosa (búsqueda, otro aviso). Si lo lleva, es el canónico del mismo aviso.
    if (id && loc) return loc.includes(id) ? 'live' : 'gone';
    return 'unknown';
  }
  if (r.status === 200) {
    const html = r.html ?? '';
    return GONE_PHRASES.some((re) => re.test(html)) ? 'gone' : 'live';
  }
  return 'unknown';
}

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

/**
 * Consulta el aviso en su portal. Nunca lanza: cualquier fallo es 'unknown'.
 * redirect:'manual' para ver el 301 de Fincaraiz en vez de seguirlo.
 */
export async function checkListingLive(url: string, timeoutMs = 6000): Promise<Liveness> {
  return (await checkListingLiveDetailed(url, timeoutMs)).verdict;
}

/** Igual que checkListingLive, más el status HTTP (el barrido lo usa para detectar bloqueos). */
export async function checkListingLiveDetailed(
  url: string,
  timeoutMs = 6000
): Promise<{ verdict: Liveness; status: number | null }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: 'manual',
      signal: ctrl.signal,
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-CO,es;q=0.9',
      },
    });
    const location = res.headers.get('location');
    const html = res.status === 200 ? await res.text() : undefined;
    return {
      verdict: classifyListingPage({ url, status: res.status, location, html }),
      status: res.status,
    };
  } catch {
    return { verdict: 'unknown', status: null };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Verifica varios avisos en paralelo con un tope por host (no martillar un
 * portal con 20 requests simultáneos). Devuelve los veredictos en el mismo
 * orden de entrada.
 */
export async function checkManyLive(
  urls: string[],
  { perHost = 4, timeoutMs = 6000 }: { perHost?: number; timeoutMs?: number } = {}
): Promise<Liveness[]> {
  const out: Liveness[] = new Array(urls.length).fill('unknown');
  const byHost = new Map<string, number[]>();
  urls.forEach((u, i) => {
    let host = '';
    try {
      host = new URL(u).host;
    } catch {
      return; // URL inválida → queda 'unknown'
    }
    byHost.set(host, [...(byHost.get(host) ?? []), i]);
  });
  await Promise.all(
    [...byHost.values()].map(async (idxs) => {
      const queue = [...idxs];
      const worker = async () => {
        for (let i = queue.shift(); i !== undefined; i = queue.shift()) {
          out[i] = await checkListingLive(urls[i], timeoutMs);
        }
      };
      await Promise.all(Array.from({ length: Math.min(perHost, queue.length) }, worker));
    })
  );
  return out;
}
