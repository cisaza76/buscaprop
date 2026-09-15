-- 021_properties_is_active.sql
-- Concepto de "inmueble que ya no está disponible" en la superficie de búsqueda.
--
-- Problema (medido 2026-08-18, ver docs/specs/2026-08-18-inmuebles-inactivos-design.md):
-- un inmueble retirado del portal le salía al usuario igual que uno vivo. En una
-- muestra estratificada de 40 fichas de Ciencuadras, 16 no estaban activas. El
-- caso pernicioso es "Inmueble No Activo": parsea como item válido con precio y
-- teléfono, se upsertea, refresca su scraped_at, y el barrido de staleness
-- —que dispara por antigüedad— nunca lo alcanza. Se auto-refresca para siempre.
--
-- Por qué una columna y no la vista property_latest_snapshot (que existe desde
-- la 008): la vista es conceptualmente más limpia pero mete un join en la ruta
-- más caliente del producto. Un predicado plano, con el mismo patrón que
-- is_duplicate —que ya existe y todo el mundo entiende— es operacionalmente
-- mejor. El rastro de auditoría sigue viviendo en property_history.
--
-- Run: copiar/pegar en Supabase SQL Editor → Run. Idempotente.

-- default true es deliberado: cualquier fila que no sepamos evaluar se
-- considera viva. El sistema falla hacia "mostrar de más", nunca hacia
-- "esconder el catálogo".
alter table public.properties
  add column if not exists is_active boolean not null default true;

comment on column public.properties.is_active is
  'false = el portal de origen ya no lo publica. Filtra la búsqueda, NO la ficha por link directo. Se reactiva solo si el portal lo vuelve a servir.';

-- Índice parcial sobre el predicado real de búsqueda.
create index if not exists idx_properties_search_live
  on public.properties (city, listing_type, property_type)
  where is_duplicate = false and is_active;

notify pgrst, 'reload schema';
