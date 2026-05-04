-- =============================================================================
-- BuscaProp — Schema base
-- =============================================================================
-- NOTA: Este archivo fue generado por Claude Code a partir de los tipos
-- declarados en lib/supabase.ts y los campos usados en 002_sample_data.sql,
-- porque el bloque "Archivo 6" en 6_FOUNDATIONAL_FILES.md llegó vacío
-- (placeholder "[Ver archivo en outputs - es el mismo que proporcione arriba]").
-- Revisar contra la versión oficial antes de ejecutar en producción.
-- =============================================================================

-- Extensiones requeridas
create extension if not exists "uuid-ossp";

-- =============================================================================
-- ENUMS
-- =============================================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'agency_plan') then
    create type agency_plan as enum ('solo', 'team', 'inmobiliaria');
  end if;
  if not exists (select 1 from pg_type where typname = 'subscription_status') then
    create type subscription_status as enum ('active', 'trial', 'cancelled');
  end if;
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type user_role as enum ('owner', 'agent');
  end if;
  if not exists (select 1 from pg_type where typname = 'source_portal') then
    create type source_portal as enum ('fincaraiz', 'metrocuadrado', 'properati', 'ciencuadras');
  end if;
  if not exists (select 1 from pg_type where typname = 'property_type') then
    create type property_type as enum ('apartamento', 'casa', 'oficina', 'lote');
  end if;
  if not exists (select 1 from pg_type where typname = 'listing_type') then
    create type listing_type as enum ('venta', 'arriendo');
  end if;
end$$;

-- =============================================================================
-- TABLAS
-- =============================================================================

-- Agencias (tenants)
create table if not exists public.agencies (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  plan agency_plan not null default 'solo',
  max_agents integer not null default 1,
  subscription_status subscription_status not null default 'trial',
  trial_ends_at timestamptz default (now() + interval '14 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Usuarios (perfil + vínculo a agencia)
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  agency_id uuid not null references public.agencies(id) on delete cascade,
  full_name text not null,
  role user_role not null default 'agent',
  created_at timestamptz not null default now()
);

-- Propiedades (inventario agregado de los portales)
create table if not exists public.properties (
  id uuid primary key default uuid_generate_v4(),
  source_portal source_portal not null,
  source_url text not null,
  title text not null,
  description text,
  price_cop bigint not null check (price_cop >= 0),
  city text not null,
  neighborhood text,
  bedrooms integer check (bedrooms >= 0),
  bathrooms integer check (bathrooms >= 0),
  area_m2 integer check (area_m2 >= 0),
  property_type property_type not null,
  listing_type listing_type not null,
  photos text[] not null default '{}',
  latitude double precision,
  longitude double precision,
  is_duplicate boolean not null default false,
  canonical_id uuid references public.properties(id) on delete set null,
  dedup_hash text,
  scraped_at timestamptz default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_portal, source_url)
);

-- Búsquedas guardadas
create table if not exists public.saved_searches (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  search_query text not null,
  filters jsonb not null default '{}'::jsonb,
  share_link_id text unique,
  alert_enabled boolean not null default false,
  alert_frequency text not null default 'daily' check (alert_frequency in ('daily', 'weekly', 'immediate')),
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =============================================================================
-- ÍNDICES
-- =============================================================================
create index if not exists idx_properties_city on public.properties (city);
create index if not exists idx_properties_listing_type on public.properties (listing_type);
create index if not exists idx_properties_property_type on public.properties (property_type);
create index if not exists idx_properties_price on public.properties (price_cop);
create index if not exists idx_properties_bedrooms on public.properties (bedrooms);
create index if not exists idx_properties_bathrooms on public.properties (bathrooms);
create index if not exists idx_properties_area on public.properties (area_m2);
create index if not exists idx_properties_is_duplicate on public.properties (is_duplicate);
create index if not exists idx_properties_source_portal on public.properties (source_portal);
create index if not exists idx_properties_canonical_id on public.properties (canonical_id);
create index if not exists idx_properties_city_listing on public.properties (city, listing_type);
create index if not exists idx_properties_created_at on public.properties (created_at desc);
create index if not exists idx_properties_dedup_hash on public.properties (dedup_hash);

create index if not exists idx_users_agency_id on public.users (agency_id);
create index if not exists idx_saved_searches_user_id on public.saved_searches (user_id);
create index if not exists idx_saved_searches_share_link on public.saved_searches (share_link_id);

-- =============================================================================
-- TRIGGER: updated_at automático
-- =============================================================================
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_agencies_touch on public.agencies;
create trigger trg_agencies_touch before update on public.agencies
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_properties_touch on public.properties;
create trigger trg_properties_touch before update on public.properties
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_saved_searches_touch on public.saved_searches;
create trigger trg_saved_searches_touch before update on public.saved_searches
  for each row execute function public.touch_updated_at();

-- =============================================================================
-- RLS — Row Level Security
-- =============================================================================
alter table public.agencies enable row level security;
alter table public.users enable row level security;
alter table public.properties enable row level security;
alter table public.saved_searches enable row level security;

-- Helpers: agencia del usuario actual
create or replace function public.current_user_agency_id()
returns uuid language sql stable security definer set search_path = public as $$
  select agency_id from public.users where id = auth.uid();
$$;

create or replace function public.current_user_role()
returns user_role language sql stable security definer set search_path = public as $$
  select role from public.users where id = auth.uid();
$$;

-- agencies: solo miembros pueden ver su agencia; solo owner puede actualizar
drop policy if exists agencies_select_own on public.agencies;
create policy agencies_select_own on public.agencies for select to authenticated
  using (id = public.current_user_agency_id());

drop policy if exists agencies_update_owner on public.agencies;
create policy agencies_update_owner on public.agencies for update to authenticated
  using (id = public.current_user_agency_id() and public.current_user_role() = 'owner')
  with check (id = public.current_user_agency_id() and public.current_user_role() = 'owner');

-- agencies: cualquier autenticado puede crear su propia agencia (durante signup)
drop policy if exists agencies_insert_self on public.agencies;
create policy agencies_insert_self on public.agencies for insert to authenticated
  with check (true);

-- users: ver miembros de la misma agencia; auto-insertar; owner gestiona la agencia
drop policy if exists users_select_same_agency on public.users;
create policy users_select_same_agency on public.users for select to authenticated
  using (agency_id = public.current_user_agency_id() or id = auth.uid());

drop policy if exists users_insert_self on public.users;
create policy users_insert_self on public.users for insert to authenticated
  with check (id = auth.uid());

drop policy if exists users_update_self_or_owner on public.users;
create policy users_update_self_or_owner on public.users for update to authenticated
  using (
    id = auth.uid()
    or (agency_id = public.current_user_agency_id() and public.current_user_role() = 'owner')
  );

drop policy if exists users_delete_owner on public.users;
create policy users_delete_owner on public.users for delete to authenticated
  using (agency_id = public.current_user_agency_id() and public.current_user_role() = 'owner' and id <> auth.uid());

-- properties: cualquier autenticado lee no-duplicados; escrituras solo via service_role
drop policy if exists properties_select_authenticated on public.properties;
create policy properties_select_authenticated on public.properties for select to authenticated
  using (true);

-- saved_searches: el dueño gestiona; lectura pública si tiene share_link_id
drop policy if exists saved_searches_owner_all on public.saved_searches;
create policy saved_searches_owner_all on public.saved_searches for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists saved_searches_public_share on public.saved_searches;
create policy saved_searches_public_share on public.saved_searches for select to anon
  using (share_link_id is not null);
