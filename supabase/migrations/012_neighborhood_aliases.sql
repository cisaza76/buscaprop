-- 012_neighborhood_aliases.sql
-- Capa de normalización de nombres de barrios.
--
-- PROBLEMA RAÍZ que esta tabla resuelve:
-- Los 4 portales (Fincaraíz, MetroCuadrado, Properati, Ciencuadras) usan
-- nombres distintos para el mismo barrio. Diagnóstico real (mayo 2026):
--   user pide "Rosales" → 0 resultados con eq("Rosales")
--   BD tiene "Los Rosales" → 32 listings
-- Sin normalización, la AI le dice al user "no hay" cuando sí hay.
--
-- Diseño:
--   - alias (lowercase + sin tildes) es la KEY de búsqueda
--   - canonical_name es el nombre como aparece en properties.neighborhood
--   - city scoping para evitar colisiones (ej: "Centro" en varias ciudades)
--   - UNIQUE(city, alias) para upsert idempotente
--
-- Mantenimiento:
--   Cuando aparezcan nombres nuevos del scraper, agregamos aliases por SQL.
--   El helper de normalización tiene fallback a fuzzy match si no hay alias.

create table if not exists public.neighborhood_aliases (
  id uuid primary key default uuid_generate_v4(),
  -- Forma normalizada del input del user: lowercase + sin tildes + sin
  -- artículos ("los rosales" → "rosales", "el chico" → "chico").
  alias text not null,
  -- Nombre EXACTO como aparece en properties.neighborhood. Case-preserving.
  canonical_name text not null,
  city text not null,
  -- Notas para debugging (ej: "agregado del scraper de fincaraiz").
  notes text,
  created_at timestamptz not null default now(),
  unique (city, alias)
);

create index if not exists idx_neighborhood_aliases_city_alias
  on public.neighborhood_aliases (city, alias);
-- Para reverse lookup: dado un canonical, ¿qué aliases tiene?
create index if not exists idx_neighborhood_aliases_canonical
  on public.neighborhood_aliases (city, canonical_name);

-- Índice GIN sobre canonical_name para búsqueda fuzzy con trigram (cuando
-- el alias no se encuentra). pg_trgm es la extensión estándar.
create extension if not exists pg_trgm;
create index if not exists idx_neighborhood_aliases_trgm
  on public.neighborhood_aliases using gin (canonical_name gin_trgm_ops);

notify pgrst, 'reload schema';
