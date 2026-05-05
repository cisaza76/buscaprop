-- 007_leads_schema_repair.sql
-- Bug: la tabla `leads` se aplicó parcialmente desde migration 005 y le faltan
-- varias columnas (agency_id, agent_id, status, summary, notes, contacted_at,
-- updated_at). Esta migration es IDEMPOTENTE — agrega solo lo que falta.

alter table public.leads
  add column if not exists agency_id uuid references public.agencies(id) on delete set null;

alter table public.leads
  add column if not exists agent_id uuid references public.users(id) on delete set null;

alter table public.leads
  add column if not exists status text not null default 'new';

-- Constraint sólo si todavía no existe.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'leads_status_check' and conrelid = 'public.leads'::regclass
  ) then
    alter table public.leads
      add constraint leads_status_check
      check (status in ('new', 'contacted', 'visited', 'won', 'lost'));
  end if;
end $$;

alter table public.leads
  add column if not exists summary text;

alter table public.leads
  add column if not exists notes text;

alter table public.leads
  add column if not exists contacted_at timestamptz;

alter table public.leads
  add column if not exists updated_at timestamptz not null default now();

-- Indices que la migration 005 prometía pero pueden no haberse creado.
create index if not exists idx_leads_status on public.leads (status);
create index if not exists idx_leads_agency on public.leads (agency_id) where agency_id is not null;
create index if not exists idx_leads_agent on public.leads (agent_id) where agent_id is not null;
create index if not exists idx_leads_score on public.leads (lead_score desc);

-- Trigger touch_updated_at — sólo si la función existe (de migration 001).
do $$
begin
  if exists (select 1 from pg_proc where proname = 'touch_updated_at') then
    drop trigger if exists trg_leads_touch on public.leads;
    create trigger trg_leads_touch before update on public.leads
      for each row execute function public.touch_updated_at();
  end if;
end $$;

-- Forzar a PostgREST a refrescar su schema cache para que las columnas sean
-- visibles inmediatamente desde la API JS.
notify pgrst, 'reload schema';
