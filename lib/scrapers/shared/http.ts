// lib/scrapers/shared/http.ts
// Cliente HTTP "respetuoso" para scrapers: User-Agent rotativo por host,
// rate limit por host, retry con status-aware backoff, timeouts.
//
// Contexto del recon (semana 2 anti-ban, 2026-05-08):
//   - Ciencuadras, Fincaraíz, Metrocuadrado, Properati toleran ≤300ms desde
//     un UA realista (probado contra cada uno).
//   - Properati 403-blockea UAs sin prefijo Mozilla; los otros 3 son
//     equivalentes a UA realista vs UA bot.
//   - Ningún portal devuelve Retry-After ni rate-limit headers — si nos
//     limitan, es WAF silent block.
//   - 36% de ticks de Inngest timeoutaban a 300s — bottleneck era el
//     minDelayMs=3500ms × TICK_MAX=35 = 122s base. Bajamos a 1500ms (5x
//     margen vs threshold real, pero deja 247s para fetch + parse + upsert).

// ============================================================================
// User-Agent rotation
// ============================================================================
//
// Pool de UAs realistas. Stickiness por host — el mismo IP cambiando UA cada
// request es señal típica de scraper. En cambio, "este IP fue Chrome 131 toda
// la sesión, después de un 403 se vuelve Safari" se parece a un usuario que
// rotó de browser. Solo rotamos en 403 (WAF block).
const UA_POOL = [
  // Chrome 131 macOS
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  // Chrome 131 Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  // Safari 17.4 macOS
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  // Chrome 131 Android
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  // Safari iOS 17.4
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
];

function pickUA(): string {
  return UA_POOL[Math.floor(Math.random() * UA_POOL.length)];
}

// UA sticky por host. Inicializa lazy en el primer request al host. Solo
// rota cuando recibe 403 (WAF block) — ver fetchText.
const uaByHost = new Map<string, string>();

function getStickyUA(host: string): string {
  let ua = uaByHost.get(host);
  if (!ua) {
    ua = pickUA();
    uaByHost.set(host, ua);
  }
  return ua;
}

function rotateUA(host: string): string {
  const prev = uaByHost.get(host);
  let ua: string;
  do {
    ua = pickUA();
  } while (ua === prev && UA_POOL.length > 1);
  uaByHost.set(host, ua);
  return ua;
}

// ============================================================================
// Rate limit por host
// ============================================================================

const lastHitByHost = new Map<string, number>();

function hostOf(url: string): string {
  return new URL(url).host;
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function gateByRateLimit(url: string, minDelayMs: number) {
  const host = hostOf(url);
  const last = lastHitByHost.get(host) ?? 0;
  const elapsed = Date.now() - last;
  if (elapsed < minDelayMs) {
    // Jitter ±300ms para no parecer perfectamente periódico (heurística
    // anti-bot común detecta cadencia perfecta).
    const jitter = Math.floor(Math.random() * 600) - 300;
    await sleep(Math.max(50, minDelayMs - elapsed + jitter));
  }
  lastHitByHost.set(host, Date.now());
}

// ============================================================================
// Headers de browser real
// ============================================================================
//
// NO mandamos Sec-Ch-Ua porque depende del Chromium version exacto del UA;
// mandar uno mismatched es peor fingerprint que omitirlo. Real browsers
// non-Chrome tampoco lo mandan.
function browserHeaders(userAgent: string): Record<string, string> {
  return {
    'User-Agent': userAgent,
    'Accept':
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'es-CO,es;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
  };
}

// ============================================================================
// fetchText
// ============================================================================

export interface HttpOptions {
  /**
   * UA explícito que sobrescribe el pool. Solo para casos especiales como
   * Properati que necesita su UA propio con sufijo BuscaProp/1.0 — el resto
   * usa el pool con sticky-per-host.
   */
  userAgent?: string;
  /** Min ms entre requests al mismo host. Default 1500ms. */
  minDelayMs?: number;
  /** Total reintentos ante 5xx/429/403/network errors. Default 3. */
  maxRetries?: number;
  /** Timeout por request en ms. Default 25_000. */
  timeoutMs?: number;
  /** Headers extra (merge sobre los de browser). */
  headers?: Record<string, string>;
}

const DEFAULTS: Required<Omit<HttpOptions, 'headers' | 'userAgent'>> = {
  minDelayMs: 1500,
  maxRetries: 3,
  timeoutMs: 25_000,
};

export class HttpError extends Error {
  constructor(public status: number, public url: string, public body?: string) {
    super(`HTTP ${status} on ${url}`);
  }
}

export async function fetchText(url: string, opts: HttpOptions = {}): Promise<string> {
  const cfg = { ...DEFAULTS, ...opts };
  const host = hostOf(url);
  let attempt = 0;
  let lastErr: unknown;

  while (attempt <= cfg.maxRetries) {
    await gateByRateLimit(url, cfg.minDelayMs);

    // UA: explícito si viene; si no, sticky por host del pool.
    const ua = opts.userAgent ?? getStickyUA(host);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

    try {
      const res = await fetch(url, {
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          ...browserHeaders(ua),
          ...opts.headers,
        },
      });

      clearTimeout(timer);

      // 429: respetar Retry-After si viene; sino 60s + jitter.
      if (res.status === 429) {
        const retryAfter = res.headers.get('retry-after');
        const waitMs = retryAfter
          ? parseRetryAfter(retryAfter)
          : 60_000 + Math.floor(Math.random() * 5000);
        console.warn(`[http] 429 on ${host} — esperando ${waitMs}ms`);
        await sleep(waitMs);
        attempt++;
        continue;
      }

      // 403: WAF block. Pause largo (~10 min) + rotar UA antes del próximo intento.
      // Si el portal está banando este UA, el siguiente attempt usa otro.
      if (res.status === 403) {
        const waitMs = 600_000 + Math.floor(Math.random() * 30_000);
        console.warn(
          `[http] 403 on ${host} — rotando UA y esperando ${Math.round(waitMs / 1000)}s`
        );
        if (!opts.userAgent) rotateUA(host); // No rotar si el caller lo pidió explícito
        await sleep(waitMs);
        attempt++;
        continue;
      }

      // 5xx: backoff exponencial corto, retry.
      if (res.status >= 500 && res.status < 600) {
        const backoffMs = 2 ** attempt * 1500 + Math.floor(Math.random() * 500);
        await sleep(backoffMs);
        attempt++;
        continue;
      }

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new HttpError(res.status, url, body.slice(0, 500));
      }

      return await res.text();
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      // Network/abort: retry con backoff.
      const backoffMs = 2 ** attempt * 1500;
      await sleep(backoffMs);
      attempt++;
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(`fetchText failed for ${url}`);
}

// "Retry-After" puede ser segundos (entero) o HTTP date (RFC 7231). Devuelve ms.
// Cap a 10 min para evitar pausas excesivas si el portal manda valor exagerado.
function parseRetryAfter(raw: string): number {
  const sec = parseInt(raw, 10);
  if (!Number.isNaN(sec) && sec > 0) return Math.min(sec * 1000, 600_000);
  const date = Date.parse(raw);
  if (!Number.isNaN(date)) {
    const ms = date - Date.now();
    return Math.max(1000, Math.min(ms, 600_000));
  }
  return 60_000;
}

// Helper para sitemaps / cualquier XML grande.
export async function fetchXml(url: string, opts?: HttpOptions): Promise<string> {
  return fetchText(url, {
    ...opts,
    headers: { ...opts?.headers, Accept: 'application/xml,text/xml;q=0.9,*/*;q=0.8' },
  });
}
