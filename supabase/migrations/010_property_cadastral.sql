-- 010_property_cadastral.sql
-- Phase 10 Capa 1: enrichment catastral via IDECA (Catastro Bogotá).
-- Una row por propiedad. Datos provienen del Esri REST de
-- serviciosgis.catastrobogota.gov.co (datos públicos, sin auth).
--
-- IMPORTANTE: el "CHIP" tradicional de Bogotá (18-20 chars) NO se expone en
-- los layers visibles del Mapa_Referencia. Lo que SÍ tenemos es LOTCODIGO
-- (12 chars, identificador único del lote en catastro) + información del
-- sector con nombre legible. Si en el futuro integramos catastroenlinea o
-- una API privada que devuelva CHIP, lo agregamos al campo `chip` ya creado.

create table if not exists public.property_cadastral (
  id uuid primary key default uuid_generate_v4(),
  property_id uuid not null references public.properties(id) on delete cascade,
  -- Status del enrichment:
  --   'verified'   → IDECA devolvió data válida
  --   'not_found'  → coords cayeron fuera del catastro (ej: rural, fuera Bogotá)
  --   'error'      → falló la query (timeout, 5xx). Re-intentable.
  status text not null check (status in ('verified', 'not_found', 'error')),
  -- ── Identificadores catastrales (cuando status='verified') ──
  -- LOTCODIGO de IDECA. 12 chars. Único por lote físico.
  lot_code text,
  -- MANCODIGO: 9 chars. Compartido por todos los lotes de una manzana.
  manzana_code text,
  -- SCACODIGO + SCANOMBRE: identificador y nombre del sector catastral.
  -- El nombre es human-readable: "SANTA BARBARA OCCIDENTAL", "CHICO NORTE",
  -- "EL POLO", etc. — sirve para validar el barrio que el portal puso.
  sector_code text,
  sector_name text,
  -- Cantidad de unidades prediales en el lote (LOTUPREDIA).
  -- Útil para detectar: 1 = casa unifamiliar, >1 = edificio/conjunto.
  predio_units int,
  -- ── Geometría / área ──
  -- Área del lote en m², calculada a partir del polígono devuelto por IDECA.
  -- Esta es el área del LOTE — no necesariamente del apartamento. Para
  -- comparar contra el `area_m2` del listing solo cuando el lote sea ~unidad.
  lot_area_m2 numeric(10, 2),
  -- ── Clasificación del suelo (POT) ──
  -- SUECSUELO: 1=urbano, 2=rural, 3=expansión (típico).
  soil_classification int,
  -- SUEAADMIN: texto del acto administrativo (ej: "Decreto 555 del 2021 - POT").
  soil_admin_act text,
  -- ── CHIP (placeholder, vacío hoy) ──
  -- Reservado para cuando integremos consulta por dirección u otra fuente.
  chip text,
  -- ── Auditoría ──
  -- Última vez que se confirmó la data contra IDECA. Usar para re-validar
  -- después de N días si querramos refrescar (catastros se actualizan
  -- ocasionalmente — POT cambia, predios se subdividen).
  validated_at timestamptz not null default now(),
  -- Si status='error', cuál fue el error (para debugging).
  error_message text,
  created_at timestamptz not null default now(),
  -- Una sola row de catastro por propiedad. Re-runs upsertean.
  unique (property_id)
);

create index if not exists idx_property_cadastral_property
  on public.property_cadastral (property_id);

-- Búsqueda inversa: dado un lote, ¿qué propiedades tiene? Útil para detectar
-- el caso multifamiliar (varias propiedades en el mismo edificio).
create index if not exists idx_property_cadastral_lot
  on public.property_cadastral (lot_code) where lot_code is not null;

create index if not exists idx_property_cadastral_sector
  on public.property_cadastral (sector_code) where sector_code is not null;

-- Status filtering para retry de errores.
create index if not exists idx_property_cadastral_status
  on public.property_cadastral (status, validated_at);

notify pgrst, 'reload schema';
