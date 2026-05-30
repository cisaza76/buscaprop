-- 019_scraper_cursor_cycle.sql
-- Soporte para el crawl con ventana CAP de Fincaraíz (cobertura pareja por tipo).
--
--   - last_cycle: número de ciclo del crawl. En el ciclo C cada sitemap drena
--     la ventana [C·CAP, C·CAP+CAP); al envolver todos los sitemaps el ciclo
--     incrementa. Ver lib/scrapers/fincaraiz.ts (advanceFincaraizCursor).
--
--   - sitemap_order_version: versión del orden determinista de sitemaps con que
--     se guardó este cursor. Cuando el código sube SITEMAP_ORDER_VERSION (porque
--     cambió orderChildSitemaps), lib/inngest/cursor.ts detecta el desfase y
--     resetea sitemap_idx/url_idx preservando+incrementando cycle. Default 0 →
--     la fila histórica de fincaraiz se migra sola en el primer load post-deploy
--     (reset al orden nuevo de la Sección 1, que la hace v1).
--
-- Run: copiar/pegar en Supabase SQL Editor → Run. Idempotente.

alter table public.scraper_cursor
  add column if not exists last_cycle integer not null default 0,
  add column if not exists sitemap_order_version integer not null default 0;

comment on column public.scraper_cursor.last_cycle is
  'Ciclo del crawl con ventana CAP (Fincaraíz). Ver fincaraiz.ts.';
comment on column public.scraper_cursor.sitemap_order_version is
  'Versión del orden de sitemaps con que se guardó el cursor; al subir en código, cursor.ts resetea posición y preserva cycle.';
