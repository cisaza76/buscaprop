-- 024_handle_new_user.sql
-- Registro atómico: agencia + perfil se crean en la base, en la misma
-- transacción que la cuenta de auth, y no desde el browser.
--
-- Bug que corrige (medido 2026-09-28): 14 cuentas en auth.users, 1 agencia,
-- 1 perfil. El registro creaba la cuenta y después hacía, desde el browser,
-- `insert into agencies … returning *`. El INSERT pasaba (agencies_insert_self),
-- pero el RETURNING necesita permiso de SELECT y agencies_select_own solo deja
-- ver la agencia propia — que el usuario aún no tiene, porque su perfil se crea
-- en el paso siguiente. El insert fallaba por RLS, el perfil nunca se creaba y
-- el usuario veía "Error en registro" con la cuenta ya creada.
--
-- SECURITY DEFINER con search_path fijo: corre con los permisos del dueño
-- (salta RLS) y no se deja secuestrar por objetos en otro schema. EXECUTE
-- revocado a anon/authenticated: solo la invoca el trigger.
--
-- Run: copiar/pegar en Supabase SQL Editor → Run. Idempotente.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_full_name text;
  v_agency_name text;
  v_agency_id uuid;
begin
  -- Idempotente: si el perfil ya existe (re-ejecución, backfill), no tocar.
  if exists (select 1 from public.users where id = new.id) then
    return new;
  end if;

  -- full_name es NOT NULL en public.users: el registro nunca puede fallar por
  -- metadata faltante, así que siempre hay un fallback.
  v_full_name := coalesce(
    nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
    split_part(new.email, '@', 1),
    'Usuario'
  );
  v_agency_name := coalesce(
    nullif(trim(new.raw_user_meta_data->>'agency_name'), ''),
    nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
    split_part(new.email, '@', 1),
    'Mi agencia'
  );

  insert into public.agencies (name, plan, max_agents, subscription_status)
  values (v_agency_name, 'solo', 1, 'trial')
  returning id into v_agency_id;

  insert into public.users (id, agency_id, full_name, role)
  values (new.id, v_agency_id, v_full_name, 'owner')
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill: cuentas creadas con el registro roto (sin fila en public.users).
-- Mismos defaults que el trigger. trial_ends_at arranca hoy (default de la
-- tabla): estas personas nunca tuvieron un trial usable.
do $$
declare
  u record;
  v_agency_id uuid;
  v_created int := 0;
begin
  for u in
    select au.id, au.email, au.raw_user_meta_data as meta
    from auth.users au
    left join public.users pu on pu.id = au.id
    where pu.id is null
  loop
    insert into public.agencies (name, plan, max_agents, subscription_status)
    values (
      coalesce(
        nullif(trim(u.meta->>'agency_name'), ''),
        nullif(trim(u.meta->>'full_name'), ''),
        split_part(u.email, '@', 1),
        'Mi agencia'
      ),
      'solo', 1, 'trial'
    )
    returning id into v_agency_id;

    insert into public.users (id, agency_id, full_name, role)
    values (
      u.id,
      v_agency_id,
      coalesce(nullif(trim(u.meta->>'full_name'), ''), split_part(u.email, '@', 1), 'Usuario'),
      'owner'
    )
    on conflict (id) do nothing;

    v_created := v_created + 1;
  end loop;
  raise notice 'backfill handle_new_user: % perfiles creados', v_created;
end;
$$;
