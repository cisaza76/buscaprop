-- 004_add_contact_fields.sql
-- Agrega columnas de contacto del agente/empresa que publicó el listing.
-- Cada portal expone parcialmente:
--   - MetroCuadrado: contactPhone + whatsapp inline en search results
--   - Fincaraíz:     landlord.name (puede ser persona o SAS) en JSON-LD
--   - Properati:     [data-test="agency-name"] en search card (sin phone público)
--   - Ciencuadras:   contacto detrás de form JS, no accesible sin browser
--
-- Después de aplicar, los siguientes scrapes poblan estos campos
-- automáticamente vía upsert idempotente.
--
-- Run: copiar/pegar en Supabase SQL Editor → Run.

alter table public.properties
  add column if not exists contact_name text,
  add column if not exists contact_phone text,
  add column if not exists company_name text;

-- Índice opcional sobre company_name para futuras búsquedas "todas las
-- propiedades de X agencia". Filtered para no indexar miles de NULLs.
create index if not exists idx_properties_company_name
  on public.properties (company_name)
  where company_name is not null;
