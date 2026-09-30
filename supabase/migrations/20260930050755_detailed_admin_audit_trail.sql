-- Durable, administrator-only history. Existing content is not backfilled as
-- invented history. Auth credentials and tokens are never copied into the log.
begin;

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default clock_timestamp(),
  actor_id uuid,
  actor_name text not null,
  actor_role text not null,
  source text not null check (source in ('database', 'storage', 'authentication', 'system')),
  schema_name text not null,
  table_name text not null,
  operation text not null check (operation in ('INSERT', 'UPDATE', 'DELETE', 'ENABLE')),
  record_id text not null,
  record_key jsonb not null,
  entity_label text not null,
  changed_fields text[] not null,
  before_data jsonb,
  after_data jsonb,
  context jsonb not null default '{}'::jsonb,
  transaction_id text not null default txid_current()::text,
  search_document tsvector generated always as (
    to_tsvector('simple'::regconfig,
      actor_name || ' ' || actor_role || ' ' || entity_label || ' ' || table_name || ' ' || record_id)
  ) stored
);

-- No foreign keys: history must survive deletion of users and business records.
create index audit_log_time_idx on public.audit_log (occurred_at desc, id desc);
create index audit_log_table_time_idx on public.audit_log (table_name, occurred_at desc, id desc);
create index audit_log_actor_time_idx on public.audit_log (actor_id, occurred_at desc, id desc);
create index audit_log_search_idx on public.audit_log using gin (search_document);

alter table public.audit_log enable row level security;
revoke all on public.audit_log from public, anon, authenticated, service_role;
grant select on public.audit_log to authenticated, service_role;
create policy audit_log_admin_read on public.audit_log for select to authenticated
using ((select private.has_any_role(array['admin'])));

create function private.reject_audit_log_changes()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Audit history cannot be edited or deleted' using errcode = '42501';
end;
$$;
revoke all on function private.reject_audit_log_changes() from public, anon, authenticated, service_role;
create trigger audit_log_immutable before update or delete on public.audit_log
for each row execute function private.reject_audit_log_changes();
create trigger audit_log_no_truncate before truncate on public.audit_log
for each statement execute function private.reject_audit_log_changes();

-- Managed Auth tables contain secrets. Use explicit allowlists, including for
-- new columns Supabase may add later. Storage snapshots contain file metadata only.
create function private.audit_safe_snapshot(_schema text, _table text, _row jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select case
    when _row is null then null
    when _schema = 'auth' and _table = 'users' then
      jsonb_strip_nulls(jsonb_build_object(
        'id', _row->'id', 'email', _row->'email',
        'email_confirmed_at', _row->'email_confirmed_at',
        'banned_until', _row->'banned_until', 'deleted_at', _row->'deleted_at',
        'is_anonymous', _row->'is_anonymous', 'created_at', _row->'created_at',
        'display_name', _row->'raw_user_meta_data'->'display_name',
        'providers', _row->'raw_app_meta_data'->'providers'))
    when _schema = 'auth' and _table = 'sessions' then
      jsonb_strip_nulls(jsonb_build_object(
        'id', _row->'id', 'user_id', _row->'user_id',
        'created_at', _row->'created_at', 'not_after', _row->'not_after',
        'aal', _row->'aal', 'user_agent', _row->'user_agent', 'ip', _row->'ip'))
    when _schema = 'storage' and _table = 'objects' then
      jsonb_strip_nulls(jsonb_build_object(
        'id', _row->'id', 'bucket_id', _row->'bucket_id', 'name', _row->'name',
        'owner_id', _row->'owner_id', 'version', _row->'version',
        'created_at', _row->'created_at', 'updated_at', _row->'updated_at',
        'size', _row->'metadata'->'size', 'mimetype', _row->'metadata'->'mimetype',
        'is_delete_marker', _row->'is_delete_marker', 'archived_at', _row->'archived_at'))
    else _row - 'search_vector'
  end;
$$;
revoke all on function private.audit_safe_snapshot(text, text, jsonb) from public, anon, authenticated, service_role;

-- SECURITY DEFINER is required only to append protected history from triggers.
-- It is private, has no callable application endpoint and has no EXECUTE grant.
create function private.capture_club_audit_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  old_raw jsonb;
  new_raw jsonb;
  old_value jsonb;
  new_value jsonb;
  row_value jsonb;
  fields text[];
  key_value jsonb := '{}'::jsonb;
  key_part text;
  record_parts text[] := '{}';
  actor uuid := auth.uid();
  actor_label text;
  actor_membership text;
  source_value text;
  resource_label text;
  related_label text;
  request_headers jsonb;
  metadata jsonb;
begin
  if TG_OP not in ('INSERT', 'UPDATE', 'DELETE') or TG_NARGS <> 1 then
    raise exception 'Invalid audit trigger';
  end if;
  old_raw := case when TG_OP <> 'INSERT' then to_jsonb(OLD) end;
  new_raw := case when TG_OP <> 'DELETE' then to_jsonb(NEW) end;
  row_value := coalesce(new_raw, old_raw);
  if TG_TABLE_SCHEMA = 'storage' and
    coalesce(row_value->>'bucket_id', '') not in ('club-public', 'club-media') then
    return null;
  end if;
  old_value := private.audit_safe_snapshot(TG_TABLE_SCHEMA, TG_TABLE_NAME, old_raw);
  new_value := private.audit_safe_snapshot(TG_TABLE_SCHEMA, TG_TABLE_NAME, new_raw);

  -- Record that a credential changed, never its hash or value.
  if TG_TABLE_SCHEMA = 'auth' and TG_TABLE_NAME = 'users' and TG_OP = 'UPDATE'
    and old_raw->'encrypted_password' is distinct from new_raw->'encrypted_password' then
    old_value := old_value || jsonb_build_object('password', '[Protegida]');
    new_value := new_value || jsonb_build_object('password', '[Contraseña cambiada]');
  end if;

  select coalesce(array_agg(key order by key), '{}'::text[]) into fields
  from (
    select jsonb_object_keys(coalesce(old_value, '{}'::jsonb) || coalesce(new_value, '{}'::jsonb)) as key
  ) keys
  where key not in ('updated_at', 'updated_by')
    and (old_value->key is distinct from new_value->key);
  -- A timestamp refresh or repeated RSVP with the same value is not a new edit.
  if TG_OP = 'UPDATE' and cardinality(fields) = 0 then return null; end if;

  foreach key_part in array string_to_array(TG_ARGV[0], ',') loop
    key_value := key_value || jsonb_build_object(key_part, row_value->key_part);
    record_parts := array_append(record_parts, coalesce(row_value->>key_part, 'null'));
  end loop;
  source_value := case TG_TABLE_SCHEMA when 'auth' then 'authentication' when 'storage' then 'storage' else 'database' end;
  -- Auth owns sessions; the authenticated account is trustworthy on creation.
  -- On deletion the initiator may be an administrator or cleanup service, so
  -- retain the system actor instead of claiming that the account logged out.
  if actor is null and TG_TABLE_SCHEMA = 'auth' and TG_TABLE_NAME = 'sessions' and TG_OP = 'INSERT' then
    actor := (row_value->>'user_id')::uuid;
  end if;
  select profile.display_name, membership.membership_role into actor_label, actor_membership
  from public.profiles profile left join public.memberships membership on membership.user_id = profile.id
  where profile.id = actor;
  actor_label := coalesce(nullif(btrim(actor_label), ''),
    case when actor is not null then 'Miembro del club'
      when source_value = 'authentication' then 'Supabase Auth'
      when current_setting('role', true) = 'service_role' then 'Servicio de backend'
      else 'Base de datos' end);
  actor_membership := coalesce(actor_membership, case when actor is null then 'system' else 'member' end);
  resource_label := coalesce(nullif(row_value->>'title', ''), nullif(row_value->>'name', ''),
    nullif(row_value->>'subject', ''), nullif(row_value->>'site_name', ''),
    nullif(row_value->>'full_name', ''), nullif(row_value->>'display_name', ''),
    nullif(row_value->>'email', ''), TG_TABLE_NAME);

  if TG_TABLE_NAME = 'event_rsvps' and TG_TABLE_SCHEMA = 'public' then
    select title into related_label from public.events where id = (row_value->>'event_id')::uuid;
    resource_label := 'Asistencia' || coalesce(' · ' || related_label, '');
  elsif TG_TABLE_NAME in ('memberships', 'committee_members', 'internal_message_recipients') or
    (TG_TABLE_SCHEMA = 'auth' and TG_TABLE_NAME = 'sessions') then
    select display_name into related_label from public.profiles where id = (row_value->>'user_id')::uuid;
    resource_label := coalesce(nullif(related_label, ''), resource_label);
  end if;
  -- Record only non-credential request context. Never copy all request headers.
  request_headers := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  metadata := jsonb_strip_nulls(jsonb_build_object(
    'database_role', nullif(current_setting('role', true), ''),
    'request_method', nullif(current_setting('request.method', true), ''),
    'request_path', nullif(current_setting('request.path', true), ''),
    'user_agent', left(request_headers->>'user-agent', 400),
    'account_user_id', case when TG_TABLE_SCHEMA = 'auth' then
      coalesce(row_value->'user_id', row_value->'id') end,
    'ip_address', case when TG_TABLE_SCHEMA = 'auth' and TG_TABLE_NAME = 'sessions' then row_value->'ip' end,
    'trigger_depth', pg_trigger_depth()));
  insert into public.audit_log (
    actor_id, actor_name, actor_role, source, schema_name, table_name, operation,
    record_id, record_key, entity_label, changed_fields, before_data, after_data, context)
  values (actor, actor_label, actor_membership, source_value, TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP,
    array_to_string(record_parts, ':'), key_value, resource_label, fields, old_value, new_value, metadata);
  return null;
end;
$$;
revoke all on function private.capture_club_audit_change() from public, anon, authenticated, service_role;

do $$
declare target record;
begin
  for target in select * from (values
    ('profiles', 'id'), ('memberships', 'user_id'), ('events', 'id'),
    ('event_rsvps', 'event_id,user_id'), ('stories', 'id'), ('site_settings', 'id'),
    ('proposals', 'id'), ('committees', 'id'), ('committee_members', 'committee_id,user_id'),
    ('activities', 'id'), ('tasks', 'id'), ('access_requests', 'id'), ('media_assets', 'id'),
    ('internal_messages', 'id'), ('internal_message_recipients', 'message_id,user_id'), ('notifications', 'id')
  ) tables(table_name, key_columns) loop
    execute format('create trigger zz_club_audit after insert or update or delete on public.%I
      for each row execute function private.capture_club_audit_change(%L)', target.table_name, target.key_columns);
  end loop;
end;
$$;
create trigger zz_club_audit after insert or update or delete on storage.objects
for each row execute function private.capture_club_audit_change('id');
create trigger zz_club_audit after insert or update or delete on auth.users
for each row execute function private.capture_club_audit_change('id');
-- Refreshing a session does not produce duplicate login records.
create trigger zz_club_audit after insert or delete on auth.sessions
for each row execute function private.capture_club_audit_change('id');

insert into public.audit_log (actor_name, actor_role, source, schema_name, table_name, operation,
  record_id, record_key, entity_label, changed_fields, after_data)
values ('Sistema', 'system', 'system', 'public', 'audit_log', 'ENABLE', 'activation',
  '{"id":"activation"}'::jsonb, 'Auditoría detallada activada', array['enabled_at'],
  jsonb_build_object('enabled_at', clock_timestamp(), 'coverage',
    'Cambios en los módulos del club, configuración, archivos, cuentas y sesiones.'));

notify pgrst, 'reload schema';
commit;
