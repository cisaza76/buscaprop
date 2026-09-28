-- 022_properties_availability_checked_at.sql
-- Cuándo se verificó por última vez que el aviso sigue publicado en su portal.
--
-- Contexto (2026-09-27): una búsqueda de arriendo en Rosales devolvió 24
-- avisos y 17 ya estaban retirados. El scraper revisita cada ficha cada
-- varias semanas y un arriendo bueno se va en días. El chat ya verifica en
-- vivo antes de mostrar (lib/ai/availability.ts), pero el dashboard no puede
-- (el browser no consulta portales ajenos por CORS). El barrido periódico
-- (scripts/sweep-availability.ts) recorre el inventario activo empezando por
-- lo verificado hace más tiempo; esta columna es su cursor.
--
-- Por qué columna propia y no reusar scraped_at: scraped_at dice "cuándo lo
-- leyó el scraper" y el re-scrape de Fincaraiz selecciona por él. Tocarlo
-- desde el barrido sacaría filas de esa cola sin haberlas corregido.
--
-- Run: copiar/pegar en Supabase SQL Editor → Run. Idempotente.

alter table public.properties
  add column if not exists availability_checked_at timestamptz;

comment on column public.properties.availability_checked_at is
  'Última verificación de que el aviso sigue publicado en el portal (barrido de disponibilidad o chat). NULL = nunca verificado.';

-- Índice parcial sobre la cola real del barrido: activo, no duplicado, por
-- portal y operación, ordenado por antigüedad de verificación.
create index if not exists idx_properties_availability_queue
  on public.properties (source_portal, listing_type, availability_checked_at nulls first)
  where is_active and not is_duplicate;

notify pgrst, 'reload schema';
