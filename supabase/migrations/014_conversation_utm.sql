-- 014_conversation_utm.sql
-- Atribución first-touch para conversations. Captura origen de tráfico al
-- crear la conversación (INSERT only). Lee de localStorage del browser, lo
-- envía /api/chat/test, y se persiste acá. NUNCA se sobreescribe después.
--
-- Política de captura cliente (lib/utm.ts):
--   utm_source/medium/campaign/term/content → LAST-TOUCH (browser sobreescribe)
--   referrer + landing_path                 → FIRST-TOUCH (browser preserva)
-- En DB: solo se escribe en INSERT, ahí se congela el snapshot.

alter table public.conversations
  add column if not exists utm_source   text,
  add column if not exists utm_medium   text,
  add column if not exists utm_campaign text,
  add column if not exists utm_term     text,
  add column if not exists utm_content  text,
  add column if not exists referrer     text,
  add column if not exists landing_path text;

-- Índices solo para los campos con cardinalidad útil para reporting.
-- utm_term/utm_content suelen ser ad-creative-IDs únicos → no vale el índice.
create index if not exists idx_conversations_utm_source
  on public.conversations (utm_source) where utm_source is not null;
create index if not exists idx_conversations_utm_campaign
  on public.conversations (utm_campaign) where utm_campaign is not null;
