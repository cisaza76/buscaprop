-- 016_scrape_observability.sql
-- Sub-fase 2b del plan anti-ban (semana 2). Dos cambios independientes pero
-- relacionados:
--
-- 1. properties.source_lastmod — timestamp del último <lastmod> que vimos en
--    el sitemap del portal para esta URL. Permite skipear el fetch de detalle
--    si el sitemap dice que la propiedad NO cambió desde la última vez.
--    Reduce drásticamente el costo de re-scrapeos: solo fetch detalle si el
--    portal indica que algo es nuevo.
--
-- 2. scrape_attempts — una row por cada request HTTP del scraper. Telemetría
--    cruda: portal, status, latencia, UA usado, error_kind. Da visibilidad
--    real de "¿cuántos 429/403/timeouts hay por portal?" sin depender de
--    Vercel logs (que tienen retención corta y filtros toscos).
--
-- Ambos son best-effort por el lado del código: si esta migración no se
-- aplicó, los scrapers siguen funcionando — simplemente no se cachea por
-- lastmod ni se registra telemetría (warn una vez por proceso, no crash).

-- ============================================================================
-- 1. properties.source_lastmod
-- ============================================================================
alter table public.properties
  add column if not exists source_lastmod timestamptz;

-- Índice parcial — la mayoría de operaciones de cache lookup filtran por
-- (source_portal, source_url) y comparan source_lastmod, así que no necesita
-- ser índice primario. Útil para reportes de "qué tan reciente es nuestra data".
create index if not exists idx_properties_source_lastmod
  on public.properties (source_lastmod desc)
  where source_lastmod is not null;

-- ============================================================================
-- 2. scrape_attempts
-- ============================================================================
create table if not exists public.scrape_attempts (
  id bigserial primary key,
  -- Portal identificable. Acepta los 4 actuales + futuros sin migración.
  portal text not null,
  -- Host extraído de la URL — útil cuando un portal usa múltiples hosts
  -- (ej. www.X.co + cdn.X.co) para análisis separado.
  host text not null,
  -- URL completa pero truncada a 500 chars para evitar storage bloat con
  -- query params largos.
  url text not null,
  -- HTTP status. Null si fue error de red (timeout/abort/DNS).
  status_code integer,
  -- Latencia desde el envío hasta recibir el primer byte de la respuesta.
  response_ms integer not null,
  -- Tamaño del body para detectar block-pages (típicamente <500 bytes).
  bytes integer,
  -- UA usado en este attempt (string completo) — permite ver si rotación
  -- está cambiando algo o si un UA específico recibe peor trato.
  ua text,
  -- # de attempt dentro del retry loop. 1 = primera vez. 2+ = reintento.
  attempt integer not null default 1,
  -- Categoría del error para agregación rápida sin parsear status_code:
  --   'ok'        → 2xx
  --   'http_4xx'  → 400-499 (excepto 429 y 403 que tienen su propia bucket)
  --   'http_429'  → rate limit cooperativo
  --   'http_403'  → WAF block (más grave que 429)
  --   'http_5xx'  → error del portal
  --   'timeout'   → AbortController lo cortó
  --   'network'   → DNS / TCP / TLS falló
  error_kind text not null,
  -- Error message truncado a 500 chars. Solo si error_kind != 'ok'.
  error_message text,
  created_at timestamptz not null default now()
);

-- Reportes típicos: error rate por portal en últimas N horas.
create index if not exists idx_scrape_attempts_portal_created
  on public.scrape_attempts (portal, created_at desc);

-- Para queries tipo "muéstrame los 403 / 429 recientes":
create index if not exists idx_scrape_attempts_error_kind
  on public.scrape_attempts (error_kind, created_at desc)
  where error_kind <> 'ok';

-- Política de retención: 30 días debería ser suficiente para análisis.
-- A 1 req cada 1.5s × 4 portales × 86400s = ~230k rows/día = 7M en 30 días.
-- A ~150 bytes por row = 1GB. Manejable pero hay que limpiar.
-- NOTA: el cleanup automático queda fuera de scope de esta migration —
-- se puede agregar luego como un cron job o trigger pg_cron si se justifica.
