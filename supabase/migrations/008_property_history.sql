-- 008_property_history.sql
-- Phase 8: histórico de precios y estado de las propiedades.
-- Persiste un snapshot SOLO cuando algo cambia (precio o status), no en cada
-- scrape — si una propiedad no cambia en 60 días, no necesitamos 60 filas
-- idénticas. La timeline se reconstruye consultando ORDER BY scraped_at DESC.
--
-- Casos de uso:
--   1. "Esta propiedad bajó $30M hace 2 semanas" → señal de comprador
--   2. "Lleva 90 días publicada, promedio del barrio: 45 días" → señal de
--      precio inflado o problema oculto
--   3. "Esta zona tuvo 12 bajadas de precio en los últimos 30 días" → estado
--      del mercado en ese barrio
--   4. "Esta propiedad fue delisted ayer" → vendida o reservada

create table if not exists public.property_history (
  id uuid primary key default uuid_generate_v4(),
  -- FK a properties. ON DELETE CASCADE: si la propiedad se borra del DB
  -- (ej: data cleanup), su histórico también se va.
  property_id uuid not null references public.properties(id) on delete cascade,
  -- Snapshot del precio en ese momento. Siempre poblado.
  price_cop bigint not null,
  -- Cuándo se tomó el snapshot. Default ahora; los scrapers pueden pasar el
  -- timestamp exacto del fetch.
  scraped_at timestamptz not null default now(),
  -- Portal de origen — útil para investigar discrepancias entre portales
  -- (ej: la misma propiedad listada en 2 portales con precios distintos).
  source_portal text not null check (
    source_portal in ('fincaraiz', 'metrocuadrado', 'properati', 'ciencuadras')
  ),
  -- Estado en este snapshot:
  --   'active'   → presente en el scrape (default)
  --   'delisted' → no apareció en el último scrape (fue retirada/vendida)
  --   'relisted' → reapareció después de estar delisted (bajó de precio?)
  status text not null default 'active' check (
    status in ('active', 'delisted', 'relisted')
  ),
  -- % de cambio respecto al snapshot anterior. NULL en el primero.
  -- Calculado por el código que inserta — no por trigger (más explícito).
  delta_pct numeric(5, 2),
  -- Diferencia absoluta en COP. Útil para queries del estilo "propiedades que
  -- bajaron más de $20M en los últimos 30 días".
  delta_cop bigint,
  created_at timestamptz not null default now()
);

-- Indices para los patrones de query principales:

-- "Timeline de una propiedad" → ORDER BY scraped_at DESC LIMIT N.
create index if not exists idx_property_history_property_timeline
  on public.property_history (property_id, scraped_at desc);

-- "Cambios de precio recientes" → últimos 30 días, scrape global.
create index if not exists idx_property_history_recent
  on public.property_history (scraped_at desc)
  where status != 'delisted';

-- "Propiedades delistadas" → search por status.
create index if not exists idx_property_history_delisted
  on public.property_history (property_id, scraped_at desc)
  where status = 'delisted';

-- Vista útil: último snapshot por propiedad. Acelera "estado actual del
-- mercado" sin escanear toda la tabla.
create or replace view public.property_latest_snapshot as
  select distinct on (property_id)
    property_id,
    price_cop,
    scraped_at,
    source_portal,
    status,
    delta_pct,
    delta_cop
  from public.property_history
  order by property_id, scraped_at desc;

-- Forzar a PostgREST a refrescar su schema cache.
notify pgrst, 'reload schema';
