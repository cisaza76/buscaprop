-- 023_neighborhoods_by_city.sql
-- Barrios distintos de una ciudad, sobre TODO el inventario vivo.
--
-- Por qué (2026-09-28): el desplegable de barrios del dashboard se armaba en
-- el browser con las primeras 5.000 filas de la ciudad (PostgREST no hace
-- SELECT DISTINCT). Bogotá tiene decenas de miles de avisos activos y el
-- desplegable mostraba 257 barrios: los que no cayeron en la muestra no se
-- podían elegir. Esta función hace el DISTINCT en la base.
--
-- security invoker (default): respeta las políticas RLS de properties.
-- Mismo predicado que la búsqueda (índice idx_properties_search_live, 021).
--
-- Run: copiar/pegar en Supabase SQL Editor → Run. Idempotente.

-- Índice que la vuelve index-only (24 ms en Bogotá vs 4,3 s — el rol anon
-- tiene statement_timeout de 3 s). CONCURRENTLY para no bloquear a los
-- scrapers; por eso va suelto, fuera de cualquier transacción. Si tras una
-- ola de updates vuelve a estar lento: VACUUM (ANALYZE) public.properties.
create index concurrently if not exists idx_properties_city_neighborhood_live
  on public.properties (city, neighborhood)
  where is_active and not is_duplicate and neighborhood is not null;

create or replace function public.neighborhoods_by_city(p_city text)
returns table (neighborhood text, listings bigint)
language sql
stable
as $$
  select p.neighborhood, count(*) as listings
  from public.properties p
  where p.city = p_city
    and p.is_duplicate = false
    and p.is_active
    and p.neighborhood is not null
  group by p.neighborhood
  order by p.neighborhood
$$;

comment on function public.neighborhoods_by_city(text) is
  'Barrios distintos (con # de avisos activos) de una ciudad. Lo usa el desplegable de barrios del dashboard.';

grant execute on function public.neighborhoods_by_city(text) to anon, authenticated;

notify pgrst, 'reload schema';
