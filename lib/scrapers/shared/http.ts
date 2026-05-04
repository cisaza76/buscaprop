// lib/scrapers/shared/http.ts
// Cliente HTTP "respetuoso" para scrapers: User-Agent identificable,
// rate limit por host, retry exponencial, timeouts.

const DEFAULT_USER_AGENT = 'BuscaProp Colombia (+contacto@buscaprop.co)';

export interface HttpOptions {
  userAgent?: string;
  /** Min ms entre requests al mismo host. Default 3500ms (conservador). */
  minDelayMs?: number;
  /** Total reintentos ante 5xx/429/network errors. Default 3. */
  maxRetries?: number;
  /** Timeout por request en ms. Default 25_000. */
  timeoutMs?: number;
  /** Headers extra. */
  headers?: Record<string, string>;
}

const DEFAULTS: Required<Omit<HttpOptions, 'headers'>> = {
  userAgent: DEFAULT_USER_AGENT,
  minDelayMs: 3500,
  maxRetries: 3,
  timeoutMs: 25_000,
};

// Última hora de request por host (para enforcement de minDelayMs).
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
    await sleep(minDelayMs - elapsed + Math.floor(Math.random() * 400));
  }
  lastHitByHost.set(host, Date.now());
}

export class HttpError extends Error {
  constructor(public status: number, public url: string, public body?: string) {
    super(`HTTP ${status} on ${url}`);
  }
}

export async function fetchText(url: string, opts: HttpOptions = {}): Promise<string> {
  const cfg = { ...DEFAULTS, ...opts };
  let attempt = 0;
  let lastErr: unknown;

  while (attempt <= cfg.maxRetries) {
    await gateByRateLimit(url, cfg.minDelayMs);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

    try {
      const res = await fetch(url, {
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent': cfg.userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'es-CO,es;q=0.9,en;q=0.5',
          ...opts.headers,
        },
      });

      clearTimeout(timer);

      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        // Backoff antes de reintentar.
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
      // Network/abort: reintentar con backoff.
      const backoffMs = 2 ** attempt * 1500;
      await sleep(backoffMs);
      attempt++;
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(`fetchText failed for ${url}`);
}

// Helper para sitemaps / cualquier XML grande.
export async function fetchXml(url: string, opts?: HttpOptions): Promise<string> {
  return fetchText(url, {
    ...opts,
    headers: { ...opts?.headers, Accept: 'application/xml,text/xml;q=0.9,*/*;q=0.8' },
  });
}
