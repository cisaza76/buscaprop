-- 003_add_dedup_hash.sql
-- Agrega la columna `dedup_hash` que el scraper usa para detección
-- cross-portal de duplicados. Sin esta columna el scraper sigue funcionando
-- pero pierde la habilidad de marcar is_duplicate=true cuando la misma
-- propiedad aparece en varios portales.
--
-- Run: copiar/pegar en Supabase SQL Editor → Run.
-- Idempotente: usar IF NOT EXISTS por si ya está.

alter table public.properties
  add column if not exists dedup_hash text;

create index if not exists idx_properties_dedup_hash
  on public.properties (dedup_hash);
