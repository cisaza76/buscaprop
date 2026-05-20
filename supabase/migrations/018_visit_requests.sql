-- 018_visit_requests.sql
-- Persistencia real de las solicitudes de visita que crea el tool `scheduleVisit`
-- del agente AI. Antes era un stub in-memory: confirmaba al usuario pero no
-- guardaba nada ni avisaba al asesor (y aun así sumaba +30 al lead score).
--
-- Cada fila = una intención de visita expresada en el chat. El asesor humano la
-- atiende fuera de banda. Status arranca en 'pending'.
--
-- Run: copiar/pegar en Supabase SQL Editor → Run. Idempotente.

create table if not exists public.visit_requests (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  property_id uuid references public.properties(id) on delete set null,
  preferred_when text,
  contact_method text not null default 'whatsapp',
  status text not null default 'pending', -- 'pending' | 'contacted' | 'scheduled' | 'cancelled'
  created_at timestamptz not null default now()
);

create index if not exists idx_visit_requests_conversation_id
  on public.visit_requests (conversation_id);
create index if not exists idx_visit_requests_status_created
  on public.visit_requests (status, created_at desc);

comment on table public.visit_requests is
  'Solicitudes de visita creadas por el tool scheduleVisit del agente AI. '
  'El asesor humano las atiende; status arranca en pending.';

-- RLS: tabla interna, solo backend con service_role escribe/lee.
alter table public.visit_requests enable row level security;
drop policy if exists "service_role full access" on public.visit_requests;
create policy "service_role full access" on public.visit_requests
  for all to service_role using (true) with check (true);
