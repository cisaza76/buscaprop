-- 006_conversation_preferences.sql
-- Phase 7A.3: persistir preferencias del usuario que la AI va descubriendo
-- a lo largo de la conversación (criterios de búsqueda + flags de cualificación).
--
-- Diseño: JSONB para evolucionar el shape sin tocar el schema. La AI llama a
-- la tool recordUserPreferences(...) y nosotros hacemos un merge contra esta
-- columna. Ejemplos de keys:
--   { city, neighborhood, property_type, listing_type,
--     min_bedrooms, min_bathrooms, min_price, max_price,
--     parking_required, urgency, financing_needed }

alter table public.conversations
  add column if not exists preferences jsonb not null default '{}'::jsonb;

-- Índice GIN sólo si querremos consultar leads por criterios — pendiente,
-- no lo creamos hoy para no inflar storage hasta tener un caso de uso.
