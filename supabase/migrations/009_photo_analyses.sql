-- 009_photo_analyses.sql
-- Phase 9: cache de análisis visual de Claude Vision por foto.
-- Una foto se analiza UNA vez (Vision tokens cuestan $) y el resultado
-- se cachea hasta que: (a) la foto cambie de URL, o (b) cambie el modelo.
--
-- Diseño: una row por (property_id, photo_url). UNIQUE constraint hace que
-- el upsert sea idempotente desde código.

create table if not exists public.photo_analyses (
  id uuid primary key default uuid_generate_v4(),
  property_id uuid not null references public.properties(id) on delete cascade,
  -- URL exacta de la foto. Si la foto cambia (CDN renueva, portal regenera
  -- thumbnails), el cache se invalida naturalmente porque la URL cambia.
  photo_url text not null,
  -- Análisis estructurado. Shape definido en lib/ai/photo-analysis.ts:
  --   { light_level, appearance, style, furnished, kitchen_type, floor_type,
  --     visible_features[], view_type, notes }
  -- Guardamos jsonb en lugar de columnas para evolucionar el shape sin
  -- migración de schema. Los reads usan typescript types con narrowing.
  analysis jsonb not null,
  -- Modelo + versión usados — sirve para invalidar cache cuando cambiamos
  -- el prompt o el modelo (ej: 'claude-haiku-4-5/v1').
  model_version text not null,
  -- Tokens consumidos (para tracking de costos).
  input_tokens int,
  output_tokens int,
  created_at timestamptz not null default now(),
  -- Idempotencia: una row por (property, foto). Upsert con onConflict.
  unique (property_id, photo_url)
);

create index if not exists idx_photo_analyses_property
  on public.photo_analyses (property_id, created_at desc);

-- Índice por modelo: si invalidamos cache global por cambio de modelo,
-- queremos borrar rápido todas las del modelo viejo.
create index if not exists idx_photo_analyses_model
  on public.photo_analyses (model_version);

notify pgrst, 'reload schema';
