-- 015_normalize_cities.sql
-- Limpieza one-shot de datos existentes — ciudades con casing/alias inconsistentes.
-- El bug raíz está en el parser de fincaraiz que extrae la última palabra del
-- slug como city. Ej: slug "san-vicente" → city='vicente', neighborhood='San'.
--
-- Corregido upstream en lib/scrapers/shared/normalize.ts (mapping CITY_CANONICAL)
-- + invocación central en upsertProperty(). Esta migración solo arregla las
-- ~2.604 rows que entraron antes de ese fix.
--
-- Hallazgos auditoría (scripts/audit-city-casing.ts, 2026-05-08):
--   1.738 rows con alias 'Cartagena de Indias' → debería ser 'Cartagena'
--   866 rows con city en lowercase puro (envigado, sabaneta, etc.)

-- ============================================================================
-- 1. Cartagena alias merge
-- ============================================================================
update public.properties
set city = 'Cartagena'
where city = 'Cartagena de Indias';

-- ============================================================================
-- 2. Antioquia área metropolitana — uppercase + tildes correctas
-- ============================================================================
update public.properties set city = 'Envigado'   where city = 'envigado';
update public.properties set city = 'Rionegro'   where city = 'rionegro';
update public.properties set city = 'Sabaneta'   where city = 'sabaneta';
update public.properties set city = 'El Retiro'  where city = 'retiro';
update public.properties set city = 'Bello'      where city = 'bello';
update public.properties set city = 'La Ceja'    where city = 'ceja';
update public.properties set city = 'Itagüí'     where city = 'itagui';
update public.properties set city = 'Guarne'     where city = 'guarne';
update public.properties set city = 'La Estrella' where city = 'estrella';
update public.properties set city = 'Copacabana' where city = 'copacabana';
update public.properties set city = 'Marinilla'  where city = 'marinilla';
update public.properties set city = 'Girardota'  where city = 'girardota';
update public.properties set city = 'Amagá'      where city = 'amaga';
update public.properties set city = 'Caldas'     where city = 'caldas';
update public.properties set city = 'Barbosa'    where city = 'barbosa';
update public.properties set city = 'Carepa'     where city = 'carepa';
update public.properties set city = 'Apartadó'   where city = 'apartado';

-- ============================================================================
-- 3. Multi-palabra que el parser cortó al último token
-- ============================================================================
update public.properties set city = 'Santa Fe de Antioquia'
  where city = 'antioquia';
update public.properties set city = 'San Vicente Ferrer'
  where city = 'vicente';
update public.properties set city = 'San Jerónimo'
  where city = 'jeronimo';
update public.properties set city = 'San Miguel'
  where city = 'miguel';
update public.properties set city = 'El Carmen de Viboral'
  where city = 'viboral';

-- ============================================================================
-- 4. Valle del Cauca / otros
-- ============================================================================
update public.properties set city = 'Jamundí'    where city = 'jamundi';
update public.properties set city = 'Palmira'    where city = 'palmira';
update public.properties set city = 'Turbo'      where city = 'turbo';

-- ============================================================================
-- 5. Limpiar neighborhoods leftover del bug del slug-parser
-- ============================================================================
-- Cuando fincaraiz parseó "san-vicente" como city='vicente', el neighborhood
-- quedó como "San" — basura. Mismo patrón con "El Carmen De", "Santafe De".
-- Estos NO son barrios reales, son fragmentos del prefijo de la ciudad.
update public.properties set neighborhood = null
where neighborhood in (
  'San',
  'Santa',
  'Santafe',
  'Santafe De',
  'Santa Fe De',
  'El',
  'La',
  'El Carmen De',
  'La Ceja'
);
