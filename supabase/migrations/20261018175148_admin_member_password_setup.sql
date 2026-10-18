-- Temporary passwords are created through the server-only Auth Admin client.
-- Only salted scrypt digests are kept here, never plaintext passwords.
create table public.account_password_setups (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  password_salt text,
  initial_password_digest text,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  constraint account_password_setup_digest check (
    (completed_at is null and password_salt ~ '^[a-f0-9]{32}$' and initial_password_digest ~ '^[a-f0-9]{128}$'
      and password_salt is not null and initial_password_digest is not null)
    or (completed_at is not null and password_salt is null and initial_password_digest is null)
  )
);
alter table public.account_password_setups enable row level security;
revoke all on public.account_password_setups from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.account_password_setups to service_role;

-- Preserve lifecycle audit while allowlisting away the temporary-password
-- comparison material, including any sensitive columns added in the future.
create or replace function private.audit_safe_snapshot(_schema text, _table text, _row jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select case
    when _row is null then null
    when _schema = 'public' and _table = 'account_password_setups' then
      jsonb_strip_nulls(jsonb_build_object('user_id', _row->'user_id', 'created_by', _row->'created_by',
        'created_at', _row->'created_at', 'completed_at', _row->'completed_at'))
    when _schema = 'auth' and _table = 'users' then
      jsonb_strip_nulls(jsonb_build_object(
        'id', _row->'id', 'email', _row->'email', 'email_confirmed_at', _row->'email_confirmed_at',
        'banned_until', _row->'banned_until', 'deleted_at', _row->'deleted_at',
        'is_anonymous', _row->'is_anonymous', 'created_at', _row->'created_at',
        'display_name', _row->'raw_user_meta_data'->'display_name', 'providers', _row->'raw_app_meta_data'->'providers'))
    when _schema = 'auth' and _table = 'sessions' then
      jsonb_strip_nulls(jsonb_build_object('id', _row->'id', 'user_id', _row->'user_id',
        'created_at', _row->'created_at', 'not_after', _row->'not_after',
        'aal', _row->'aal', 'user_agent', _row->'user_agent', 'ip', _row->'ip'))
    when _schema = 'storage' and _table = 'objects' then
      jsonb_strip_nulls(jsonb_build_object('id', _row->'id', 'bucket_id', _row->'bucket_id', 'name', _row->'name',
        'owner_id', _row->'owner_id', 'version', _row->'version', 'created_at', _row->'created_at', 'updated_at', _row->'updated_at',
        'size', _row->'metadata'->'size', 'mimetype', _row->'metadata'->'mimetype',
        'is_delete_marker', _row->'is_delete_marker', 'archived_at', _row->'archived_at'))
    else _row - 'search_vector'
  end;
$$;
create trigger zz_club_audit after insert or update or delete on public.account_password_setups
for each row execute function private.capture_club_audit_change('user_id');

create function private.account_password_state()
returns text language plpgsql stable security definer set search_path = '' as $$
declare setup public.account_password_setups; must_change boolean;
begin
  select u.raw_app_meta_data ->> 'require_password_change' = 'true'
    into must_change from auth.users u where u.id = (select auth.uid());
  select * into setup from public.account_password_setups where user_id = (select auth.uid());
  if coalesce(must_change, false) or (setup.user_id is not null and setup.completed_at is null) then
    return 'required';
  end if;
  -- A JWT obtained with the temporary password must not gain access after setup.
  -- Require a new live session created after the password change.
  if setup.completed_at is not null and not exists (
    select 1 from auth.sessions s where s.user_id = (select auth.uid())
      and s.id::text = (select auth.jwt()) ->> 'session_id'
      and s.created_at >= setup.completed_at
      and (s.not_after is null or s.not_after > now())
  ) then return 'sign_in_again'; end if;
  return 'ready';
end;
$$;
revoke all on function private.account_password_state() from public, anon, authenticated, service_role;
grant execute on function private.account_password_state() to authenticated;

create function public.account_password_state()
returns text language sql stable security invoker set search_path = ''
as $$ select private.account_password_state(); $$;
revoke all on function public.account_password_state() from public, anon, authenticated, service_role;
grant execute on function public.account_password_state() to authenticated;

create or replace function private.is_active_member()
returns boolean language sql stable security definer set search_path = '' as $$
  select (select private.account_password_state()) = 'ready' and exists (
    select 1 from public.memberships m where m.user_id = (select auth.uid()) and m.membership_status = 'active'
  );
$$;
create or replace function private.has_any_role(required_roles text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select (select private.account_password_state()) = 'ready' and exists (
    select 1 from public.memberships m where m.user_id = (select auth.uid())
      and m.membership_status = 'active' and m.membership_role = any(required_roles)
      and (m.membership_role not in ('admin','club_manager') or (select private.has_recent_second_factor()))
  );
$$;
create or replace function public.has_privileged_session()
returns boolean language sql stable security invoker set search_path = '' as $$
  select private.has_recent_second_factor() and private.account_password_state() = 'ready';
$$;

-- Apply the same gate to direct Data/Storage requests, including policies that
-- grant ownership access without calling the common membership helpers.
do $$ declare target record; begin
  for target in select n.nspname as schema_name, c.relname as table_name
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relrowsecurity and c.relkind in ('r','p')
      and (n.nspname = 'public' or (n.nspname = 'storage' and c.relname = 'objects'))
  loop
    execute format('create policy account_initial_password_gate on %I.%I as restrictive for all to authenticated
      using ((select private.account_password_state()) = ''ready'')
      with check ((select private.account_password_state()) = ''ready'')', target.schema_name, target.table_name);
  end loop;
end $$;
notify pgrst, 'reload schema';
