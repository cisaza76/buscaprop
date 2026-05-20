-- 017_rls_pii_tables.sql
-- Habilita Row Level Security en las tablas con PII que en MVP quedaron abiertas
-- (ver comentario en 005_conversations_and_leads.sql: "RLS deshabilitada en MVP").
--
-- Contexto: TODO el acceso de la app a estas tablas pasa por service_role
-- (endpoint /api/chat/test, webhook /api/leads/notify, viewer admin). Ningún
-- cliente browser (anon key) lee estas tablas directamente. Por eso habilitar
-- RLS SIN policies permisivas para anon/authenticated NO rompe nada: service_role
-- bypassa RLS, y todos los demás roles quedan denegados por defecto.
--
-- Esto cierra el gap de que, si la anon key se usara contra estas tablas (hoy o a
-- futuro por error), expondría conversaciones, mensajes y leads de todos.
--
-- Run: copiar/pegar en Supabase SQL Editor → Run. Idempotente.

-- ── conversations ──────────────────────────────────────────────────────────
alter table public.conversations enable row level security;
drop policy if exists "service_role full access" on public.conversations;
create policy "service_role full access" on public.conversations
  for all to service_role using (true) with check (true);

-- ── conversation_messages ──────────────────────────────────────────────────
alter table public.conversation_messages enable row level security;
drop policy if exists "service_role full access" on public.conversation_messages;
create policy "service_role full access" on public.conversation_messages
  for all to service_role using (true) with check (true);

-- ── leads ──────────────────────────────────────────────────────────────────
alter table public.leads enable row level security;
drop policy if exists "service_role full access" on public.leads;
create policy "service_role full access" on public.leads
  for all to service_role using (true) with check (true);

comment on table public.conversations is
  'PII (teléfono, preferencias, mensajes). RLS ON desde 017 — solo service_role. '
  'Cuando exista agent-dashboard, agregar policies de lectura por agency_id.';
