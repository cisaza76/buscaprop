// lib/scrapers/shared/sitemap.ts
// Helpers compartidos para parsear sitemaps XML preservando <lastmod> y para
// filtrar URLs que ya tenemos cacheadas con un lastmod ≥ el del sitemap.
//
// Permite skipear el fetch de detalle cuando el portal indica que la
// propiedad NO cambió desde la última vez. Reduce costo de re-scrape y
// libera tiempo del tick para procesar URLs nuevas.
//
// Uso típico desde un scraper:
//   const entries = parseUrlSetWithLastmod(xml);
//   const toScrape = await filterUrlsToScrape('ciencuadras', entries);
//   for (const e of toScrape) {
//     const html = await fetchText(e.url, { portal: 'ciencuadras' });
//     const property = parse(html);
//     if (property) await upsertProperty({ ...property, source_lastmod: e.lastmod });
//   }
//
// Best-effort: si la columna source_lastmod no existe (migration 016 no
// aplicada), filterUrlsToScrape devuelve todas las entries (= no caching) y
// warn una vez por proceso.

import { XMLParser } from 'fast-xml-parser';
import { supabaseAdmin } from '../../supabase';
import type { SourcePortal } from './types';

export interface SitemapEntry {
  url: string;
  /** ISO string si el sitemap lo declaró. Null si no, o si parse falló. */
  lastmod: string | null;
}

const xmlParser = new XMLParser({ ignoreAttributes: true });

// `<urlset>` con `<url><loc>...</loc><lastmod>...</lastmod></url>`.
export function parseUrlSetWithLastmod(xml: string): SitemapEntry[] {
  const data = xmlParser.parse(xml);
  const raw = data?.urlset?.url;
  const list: Array<{ loc?: string; lastmod?: string }> = Array.isArray(raw)
    ? raw
    : raw
      ? [raw]
      : [];
  return list
    .map((u) => ({
      url: typeof u?.loc === 'string' ? u.loc : '',
      lastmod: normalizeLastmod(u?.lastmod),
    }))
    .filter((e) => e.url.length > 0);
}

// `<sitemapindex>` con `<sitemap><loc>...</loc><lastmod>...</lastmod></sitemap>`.
export function parseSitemapIndexWithLastmod(xml: string): SitemapEntry[] {
  const data = xmlParser.parse(xml);
  const raw = data?.sitemapindex?.sitemap;
  const list: Array<{ loc?: string; lastmod?: string }> = Array.isArray(raw)
    ? raw
    : raw
      ? [raw]
      : [];
  return list
    .map((s) => ({
      url: typeof s?.loc === 'string' ? s.loc : '',
      lastmod: normalizeLastmod(s?.lastmod),
    }))
    .filter((e) => e.url.length > 0);
}

// "2026-05-07" / "2026-05-07T12:34:56Z" / RFC 1123 → ISO string. Null si
// no parsea como fecha válida.
function normalizeLastmod(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

let warnedColumnMissing = false;
let warnedNoClient = false;

/**
 * Filtra `entries` dejando solo las URLs que necesitan re-fetch:
 *   - URL nueva (no existe en properties para ese portal), o
 *   - el sitemap declara un lastmod estrictamente más nuevo que el cacheado, o
 *   - el sitemap NO declara lastmod (no podemos comparar → scrapear por seguridad)
 *
 * Si la columna `source_lastmod` aún no existe (migration 016 no aplicada),
 * retorna todas las entries (= no caching activo).
 */
export async function filterUrlsToScrape(
  portal: SourcePortal,
  entries: SitemapEntry[]
): Promise<SitemapEntry[]> {
  if (entries.length === 0) return [];
  if (!supabaseAdmin) {
    if (!warnedNoClient) {
      console.warn('[sitemap-cache] supabaseAdmin no disponible — sin filtrado por lastmod');
      warnedNoClient = true;
    }
    return entries;
  }

  const urls = entries.map((e) => e.url);
  // Supabase .in() acepta hasta ~1000 valores. En batches grandes lo
  // partiríamos, pero TICK_MAX=35 y los sitemaps típicos ≤200 URLs por
  // sub-sitemap mantienen esto bajo el límite.
  const { data, error } = await supabaseAdmin
    .from('properties')
    .select('source_url, source_lastmod')
    .eq('source_portal', portal)
    .in('source_url', urls);

  if (error) {
    const msg = error.message ?? '';
    if (/source_lastmod/.test(msg) && /does not exist|column/i.test(msg)) {
      if (!warnedColumnMissing) {
        console.warn(
          '⚠️  Columna source_lastmod no existe. Aplicar migration 016. ' +
            'Cache por lastmod desactivado — se scrapean todas las URLs.'
        );
        warnedColumnMissing = true;
      }
      return entries;
    }
    console.warn(`[sitemap-cache] lookup failed: ${msg} — scrapeando todas`);
    return entries;
  }

  const knownByUrl = new Map<string, string | null>();
  for (const row of (data ?? []) as Array<{
    source_url: string;
    source_lastmod: string | null;
  }>) {
    knownByUrl.set(row.source_url, row.source_lastmod);
  }

  return entries.filter((e) => {
    const known = knownByUrl.get(e.url);
    // No cacheada → scrapear.
    if (known === undefined) return true;
    // No tenemos lastmod previo → scrapear (primer fetch con tracking).
    if (!known) return true;
    // El sitemap no declara lastmod → no podemos comparar, scrapear.
    if (!e.lastmod) return true;
    // Sitemap declara algo más nuevo que lo cacheado → scrapear.
    return Date.parse(e.lastmod) > Date.parse(known);
  });
}
