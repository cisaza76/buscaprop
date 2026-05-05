-- 011_property_certificates.sql
-- Phase 10 Capa 2: validación de certificado de tradición y libertad.
-- Una row por certificado subido (puede haber varios por propiedad si se
-- re-suben con cert más reciente). El más nuevo "valid" gana.
--
-- Diseño:
--   - NO guardamos el PDF original (Supabase Storage queda para después).
--     Solo metadata + texto extraído. Si el user quiere ver el PDF, re-sube.
--   - SNR validation es BEST-EFFORT — el JSF flow de SuperNotariado no es
--     una API estable, así que el status puede ser 'pending' por buen tiempo.
--   - El valor real de esta tabla es el RESUMEN del certificado: total
--     anotaciones, propietario actual, gravámenes vigentes — eso le sirve
--     al comprador hoy, sin depender de SNR responder bien.

create table if not exists public.property_certificates (
  id uuid primary key default uuid_generate_v4(),
  property_id uuid not null references public.properties(id) on delete cascade,

  -- ── Datos extraídos del PDF (high confidence — son texto literal) ──
  pin text not null,
  matricula text not null,
  -- NUPRE (Número Único Predial) — el "CHIP" oficial moderno de Colombia.
  -- Formato típico Bogotá: AAA0000XYNN. Distinto del LOTCODIGO de IDECA.
  nupre text,
  codigo_catastral text,
  -- Fecha de impresión del cert según el PDF (no fecha de subida).
  certificate_issued_at timestamptz,
  -- Vigencia: 30 días desde impresión típicamente.
  certificate_expires_at timestamptz,
  estado_folio text, -- "ACTIVO", "CERRADO", etc.
  total_anotaciones int,

  -- ── Análisis del historial (computado a partir del texto) ──
  -- Última anotación tipo COMPRAVENTA — propietario actual.
  current_owner text,
  current_owner_id text, -- CC# o NIT#
  last_sale_date date,
  last_sale_value_cop bigint,
  -- Hay gravámenes vigentes (anotaciones GRAVAMEN/EMBARGO/HIPOTECA NO canceladas).
  has_active_liens boolean not null default false,
  active_liens_count int not null default 0,
  -- Texto resumen de gravámenes vigentes (para mostrar al comprador).
  active_liens_summary text,

  -- ── Validación SNR (best-effort) ──
  -- Status del intento de validación contra el portal SNR:
  --   'pending'  → todavía no se intentó (default)
  --   'received' → SNR respondió "received" (ej: dialog show, sin afirmación clara)
  --   'valid'    → SNR confirmó válido (path muy específico)
  --   'invalid'  → SNR explícitamente rechazó
  --   'expired'  → cert vencido (>30 días desde impresión)
  --   'error'    → falló el flujo (timeout, captcha, server change)
  snr_status text not null default 'pending'
    check (snr_status in ('pending', 'received', 'valid', 'invalid', 'expired', 'error')),
  snr_validated_at timestamptz,
  snr_error_message text,

  -- ── Auditoría ──
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_certificates_property
  on public.property_certificates (property_id, uploaded_at desc);
-- Buscar por matrícula — útil si se re-sube cert para la misma propiedad
-- con matrícula consistente.
create index if not exists idx_certificates_matricula
  on public.property_certificates (matricula);
-- Status filter para retry de validaciones.
create index if not exists idx_certificates_snr_status
  on public.property_certificates (snr_status, uploaded_at);


-- ── Anotaciones del certificado (1 por anotación del PDF) ──
-- Tabla normalizada: el texto completo de cada anotación se guarda para que
-- el comprador pueda revisar el historial sin re-uploadear el PDF.
create table if not exists public.property_certificate_anotaciones (
  id uuid primary key default uuid_generate_v4(),
  certificate_id uuid not null references public.property_certificates(id) on delete cascade,
  numero int not null, -- 1, 2, 3, ...
  fecha date,
  radicacion text,
  documento text, -- "ESCRITURA 4214 DEL 09-08-1956 NOTARIA 4A DE BOGOTA"
  valor_acto_cop bigint, -- VALOR ACTO si aparece (compra-ventas)
  especificacion text, -- "MODO DE ADQUISICION: 191 COMPRA VENTA"
  -- Categoría para filtros rápidos:
  --   'compraventa', 'gravamen', 'cancelacion', 'embargo', 'hipoteca',
  --   'sucesion', 'aporte', 'otro'
  categoria text,
  -- Si es 'cancelacion', a qué número de anotación canceló.
  cancela_anotacion_numero int,
  -- ¿Esta anotación está cancelada por una posterior?
  is_cancelled boolean not null default false,
  -- Texto raw de la anotación entera — útil para debugging y para mostrar
  -- al user el historial completo si lo solicita.
  texto_raw text,
  created_at timestamptz not null default now(),
  unique (certificate_id, numero)
);

create index if not exists idx_anotaciones_certificate
  on public.property_certificate_anotaciones (certificate_id, numero);
create index if not exists idx_anotaciones_categoria
  on public.property_certificate_anotaciones (categoria) where categoria is not null;

notify pgrst, 'reload schema';
