-- 005_conversations_and_leads.sql
-- Phase 7A: chatbot IA conversacional. 3 tablas:
--   - conversations:        sesión chat (web o whatsapp), 1 row por sesión
--   - conversation_messages: mensajes individuales (user/assistant/tool)
--   - leads:                conversación promovida cuando lead_score crosses umbral
--
-- RLS: deshabilitada en MVP — el endpoint /api/chat/test usa service_role.
-- Cuando expongamos /agent-dashboard/leads para agentes, agregamos policies
-- (agency_id-scoped) en una migración futura.

create extension if not exists "uuid-ossp";

-- ============================================================================
-- conversations
-- ============================================================================
create table if not exists public.conversations (
  id uuid primary key default uuid_generate_v4(),
  -- Identificación del usuario:
  -- - channel='web':      session_id es un UUID generado en el browser (localStorage)
  -- - channel='whatsapp': user_phone es el número en E.164 sin '+'
  channel text not null check (channel in ('web', 'whatsapp')),
  session_id text,
  user_phone text,
  -- Si la conversación arrancó desde una propiedad específica (ej: click "Chat" en PropertyCard).
  property_id uuid references public.properties(id) on delete set null,
  -- Score 0-100 calculado heurísticamente + por la AI.
  lead_score int not null default 0 check (lead_score between 0 and 100),
  -- Estado del lifecycle:
  --   active     → conversación activa, agente AI manejando
  --   qualified  → score >= 70, marcada para handoff a agente humano
  --   escalated  → agente humano tomó la conversación
  --   closed     → cerrada (won/lost/timeout)
  status text not null default 'active'
    check (status in ('active', 'qualified', 'escalated', 'closed')),
  -- Agencia/agente asignado (para handoff y métricas).
  agency_id uuid references public.agencies(id) on delete set null,
  agent_id uuid references public.users(id) on delete set null,
  -- Last activity para idle timeouts.
  last_message_at timestamptz default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_conversations_session_id on public.conversations (session_id) where session_id is not null;
create index if not exists idx_conversations_user_phone on public.conversations (user_phone) where user_phone is not null;
create index if not exists idx_conversations_status on public.conversations (status);
create index if not exists idx_conversations_lead_score on public.conversations (lead_score desc);
create index if not exists idx_conversations_agency on public.conversations (agency_id) where agency_id is not null;

-- ============================================================================
-- conversation_messages
-- ============================================================================
create table if not exists public.conversation_messages (
  id uuid primary key default uuid_generate_v4(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  -- Roles del Anthropic API:
  --   user      → mensaje del usuario humano
  --   assistant → respuesta de Claude (texto + opcional tool_calls)
  --   tool      → resultado de un tool call (alimentado de vuelta a la AI)
  --   system    → no usamos (system prompt va inline en cada request)
  role text not null check (role in ('user', 'assistant', 'tool')),
  content text not null default '',
  -- Cuando role=assistant y la AI invocó un tool:
  --   [{"id": "toolu_...", "name": "searchProperties", "input": {...}}]
  tool_calls jsonb,
  -- Cuando role=tool, qué devolvió ese tool:
  --   {"tool_use_id": "toolu_...", "result": "...", "is_error": false}
  tool_result jsonb,
  -- Token usage para tracking de costos (Anthropic usage object).
  usage jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_conversation_messages_conv
  on public.conversation_messages (conversation_id, created_at);

-- Trigger: cuando llega un mensaje, actualizar last_message_at en conversations.
create or replace function public.touch_conversation_last_message()
returns trigger language plpgsql as $$
begin
  update public.conversations
    set last_message_at = new.created_at, updated_at = now()
    where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists trg_conv_messages_touch on public.conversation_messages;
create trigger trg_conv_messages_touch after insert on public.conversation_messages
  for each row execute function public.touch_conversation_last_message();

-- ============================================================================
-- leads
-- ============================================================================
-- Una conversación se "promueve" a lead cuando lead_score >= 70 o cuando la
-- AI dispara explícitamente la herramienta de escalamiento. Mantenemos leads
-- como tabla separada (vs view) para poder agregar fields del flujo comercial
-- sin tocar conversations: assigned_at, contacted_at, notes, won/lost.
create table if not exists public.leads (
  id uuid primary key default uuid_generate_v4(),
  conversation_id uuid not null unique references public.conversations(id) on delete cascade,
  property_id uuid references public.properties(id) on delete set null,
  agency_id uuid references public.agencies(id) on delete set null,
  agent_id uuid references public.users(id) on delete set null,
  lead_score int not null,
  status text not null default 'new'
    check (status in ('new', 'contacted', 'visited', 'won', 'lost')),
  -- Resumen ejecutivo generado por la AI (1-2 frases): ¿qué quiere?, ¿cuánto presupuesto?
  summary text,
  notes text,
  contacted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_leads_status on public.leads (status);
create index if not exists idx_leads_agency on public.leads (agency_id) where agency_id is not null;
create index if not exists idx_leads_agent on public.leads (agent_id) where agent_id is not null;
create index if not exists idx_leads_score on public.leads (lead_score desc);

-- Trigger: updated_at en leads.
drop trigger if exists trg_leads_touch on public.leads;
create trigger trg_leads_touch before update on public.leads
  for each row execute function public.touch_updated_at();
