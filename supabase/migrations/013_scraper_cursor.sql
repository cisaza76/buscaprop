-- 013_scraper_cursor.sql
-- Tabla para tracking incremental del progreso de scraping por portal.
-- Permite reanudar runs interrumpidos y procesar inventarios grandes en chunks
-- sin saturar timeouts (Vercel 300s, Inngest 5min/step).
--
-- Usado por: lib/inngest/scraper.ts (Inngest workers) y scripts/scrape-once.ts
--   con flag --resume.
--
-- Run: copiar/pegar en Supabase SQL Editor → Run.

create table if not exists public.scraper_cursor (
  portal text primary key,
  -- Para Fincaraíz/Ciencuadras (sitemap-based): índice del último child
  -- sitemap procesado y posición dentro de él.
  last_sitemap_idx integer not null default 0,
  last_url_idx integer not null default 0,
  -- Para MetroCuadrado (combo-based): índice del último combo procesado.
  last_combo_idx integer not null default 0,
  -- Para Properati: similar a sitemap idx.
  -- Métricas observables del estado actual.
  total_processed integer not null default 0,
  total_upserted integer not null default 0,
  last_run_at timestamptz,
  last_run_status text, -- 'success' | 'partial' | 'error'
  last_run_message text,
  updated_at timestamptz not null default now()
);

-- Sembrar las 4 filas iniciales (idempotente).
insert into public.scraper_cursor (portal) values
  ('fincaraiz'),
  ('metrocuadrado'),
  ('ciencuadras'),
  ('properati')
on conflict (portal) do nothing;

-- Trigger para updated_at automático.
create or replace function public.scraper_cursor_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_scraper_cursor_updated_at on public.scraper_cursor;
create trigger trg_scraper_cursor_updated_at
  before update on public.scraper_cursor
  for each row execute function public.scraper_cursor_set_updated_at();

-- Comentarios.
comment on table public.scraper_cursor is
  'Cursor incremental por portal — permite reanudar scraping interrumpido y procesar inventarios grandes en chunks.';
comment on column public.scraper_cursor.last_sitemap_idx is
  'Índice del último child sitemap procesado (Fincaraíz/Ciencuadras).';
comment on column public.scraper_cursor.last_url_idx is
  'Posición dentro del child sitemap actual (offset de URLs ya procesadas).';
comment on column public.scraper_cursor.last_combo_idx is
  'Índice del último combo {city,type,op,barrio} procesado (MetroCuadrado).';

-- RLS: la tabla es interna (solo se modifica desde backend con service_role).
-- Habilitar RLS y agregar policy permisiva para service_role.
alter table public.scraper_cursor enable row level security;

-- Policy: service_role tiene full access (Inngest workers usan service_role).
drop policy if exists "service_role full access" on public.scraper_cursor;
create policy "service_role full access" on public.scraper_cursor
  for all
  to service_role
  using (true)
  with check (true);

-- Re-sembrar las 4 filas (sin RLS bloqueando ahora).
insert into public.scraper_cursor (portal) values
  ('fincaraiz'),
  ('metrocuadrado'),
  ('ciencuadras'),
  ('properati')
on conflict (portal) do nothing;
