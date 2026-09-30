-- Run with psql -X --set ON_ERROR_STOP=1 --file <this file>.
-- All fixtures and their history roll back together. No existing data is changed.
begin;

do $$ begin
  assert (select count(*) from pg_trigger where tgname = 'zz_club_audit' and tgenabled = 'O') = 19,
    'All 16 platform tables, Storage and two Auth tables must be covered';
  assert not has_function_privilege('authenticated', 'private.capture_club_audit_change()', 'EXECUTE'),
    'The log writer must not be callable by users';
  assert not has_table_privilege('authenticated', 'public.audit_log', 'INSERT'), 'No user can forge history';
  assert not has_table_privilege('authenticated', 'public.audit_log', 'DELETE'), 'No user can delete history';
end $$;

insert into auth.users (id, email, raw_user_meta_data, encrypted_password) values
  ('a1111111-1111-4111-8111-111111111111', 'audit-admin@example.invalid', '{"display_name":"Administrador temporal de auditoría"}', 'secret-initial-password-hash'),
  ('a2222222-2222-4222-8222-222222222222', 'audit-member@example.invalid', '{"display_name":"Miembro temporal de auditoría"}', 'secret-initial-password-hash');
update public.memberships set membership_role = 'admin', membership_status = 'active'
where user_id = 'a1111111-1111-4111-8111-111111111111';
update public.memberships set membership_status = 'active'
where user_id = 'a2222222-2222-4222-8222-222222222222';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select set_config('request.headers', '{"user-agent":"Audit test browser","authorization":"never-copy-this-token","apikey":"never-copy-this-key"}', true);

insert into public.events (id, title, slug, starts_at, status, is_public, venue_name)
values ('b1111111-1111-4111-8111-111111111111', 'Evento temporal de auditoría', 'evento-temporal-auditoria', now() + interval '7 days', 'published', false, 'Lugar anterior');
update public.events set title = 'Evento temporal editado', venue_name = 'Lugar nuevo'
where id = 'b1111111-1111-4111-8111-111111111111';
update public.events set title = title where id = 'b1111111-1111-4111-8111-111111111111';

do $$ begin
  assert (select count(*) from public.audit_log where table_name = 'events' and operation = 'UPDATE'
    and record_id = 'b1111111-1111-4111-8111-111111111111') = 1, 'No-op edits must not add history';
  assert exists (select 1 from public.audit_log where table_name = 'events' and operation = 'UPDATE'
    and record_id = 'b1111111-1111-4111-8111-111111111111'
    and actor_id = 'a1111111-1111-4111-8111-111111111111'
    and actor_name = 'Administrador temporal de auditoría'
    and changed_fields = array['title', 'venue_name']
    and before_data->>'venue_name' = 'Lugar anterior' and after_data->>'venue_name' = 'Lugar nuevo'),
    'History must retain actor, changed fields, old and new values';
  begin
    update public.audit_log set actor_name = 'Forged';
    raise exception 'Administrator could modify history';
  exception when insufficient_privilege then null; end;
end $$;

select set_config('request.jwt.claims', '{"sub":"a2222222-2222-4222-8222-222222222222","role":"authenticated","user_metadata":{"role":"admin"}}', true);
insert into public.event_rsvps (event_id, user_id, rsvp_status)
values ('b1111111-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222222', 'going');
insert into public.event_rsvps (event_id, user_id, rsvp_status)
values ('b1111111-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222222', 'going')
on conflict (event_id, user_id) do update set rsvp_status = excluded.rsvp_status;
update public.event_rsvps set rsvp_status = 'declined'
where event_id = 'b1111111-1111-4111-8111-111111111111' and user_id = 'a2222222-2222-4222-8222-222222222222';
do $$ begin
  assert (select count(*) from public.audit_log) = 0, 'A member or editable metadata cannot reveal audit records';
  begin
    insert into public.audit_log (actor_name) values ('Forged');
    raise exception 'Member could forge history';
  exception when insufficient_privilege then null; end;
end $$;

select set_config('request.jwt.claims', '{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
delete from public.events where id = 'b1111111-1111-4111-8111-111111111111';
do $$ begin
  assert exists (select 1 from public.audit_log where table_name = 'events' and operation = 'DELETE'
    and before_data->>'title' = 'Evento temporal editado' and after_data is null), 'Deleted content must remain auditable';
  assert exists (select 1 from public.audit_log where table_name = 'event_rsvps' and operation = 'DELETE'
    and record_key->>'event_id' = 'b1111111-1111-4111-8111-111111111111'
    and before_data->>'rsvp_status' = 'declined'), 'Cascade deletions must be audited';
  assert (select count(*) from public.audit_log where table_name = 'event_rsvps' and operation = 'INSERT'
    and record_key->>'event_id' = 'b1111111-1111-4111-8111-111111111111') = 1, 'Repeated RSVP must not duplicate audit history';
end $$;

-- Managed Auth and Storage operations: whitelist secrets out of every snapshot.
reset role;
select set_config('request.jwt.claims', '{}', true);
insert into auth.sessions (id, user_id, user_agent, ip, refresh_token_hmac_key)
values ('c1111111-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222222', 'Session test browser', '192.0.2.1', 'secret-session-key');
update auth.users set encrypted_password = 'secret-new-password-hash', last_sign_in_at = now()
where id = 'a2222222-2222-4222-8222-222222222222';
delete from auth.sessions where id = 'c1111111-1111-4111-8111-111111111111';
insert into storage.objects (id, bucket_id, name, metadata, user_metadata)
values ('d1111111-1111-4111-8111-111111111111', 'club-public', 'audit-test.png',
  '{"size":128,"mimetype":"image/png","token":"secret-storage-token"}', '{"password":"secret-file-password"}');
delete from storage.objects where id = 'd1111111-1111-4111-8111-111111111111';
do $$ begin
  assert (select count(*) from public.audit_log where schema_name = 'auth' and table_name = 'sessions'
    and record_id = 'c1111111-1111-4111-8111-111111111111') = 2, 'Session creation and closure must be recorded';
  assert exists (select 1 from public.audit_log where schema_name = 'auth' and table_name = 'sessions'
    and operation = 'INSERT' and record_id = 'c1111111-1111-4111-8111-111111111111'
    and actor_id = 'a2222222-2222-4222-8222-222222222222'), 'Auth must attribute a new session to its verified account';
  assert exists (select 1 from public.audit_log where schema_name = 'auth' and table_name = 'users'
    and operation = 'UPDATE' and 'password' = any(changed_fields)
    and after_data->>'password' = '[Contraseña cambiada]'), 'A password change must be visible without its value';
  assert not exists (select 1 from public.audit_log where
    coalesce(before_data::text, '') || coalesce(after_data::text, '') || context::text
    ~ 'secret-initial-password-hash|secret-new-password-hash|secret-session-key|secret-storage-token|secret-file-password|never-copy-this-token|never-copy-this-key'),
    'No credential, token or arbitrary metadata may leak';
  assert (select count(*) from public.audit_log where schema_name = 'storage'
    and record_id = 'd1111111-1111-4111-8111-111111111111') = 2, 'File upload and deletion must be recorded';
  begin
    truncate public.audit_log;
    raise exception 'History could be truncated';
  exception when insufficient_privilege then null; end;
end $$;

set local role anon;
do $$ begin
  begin
    perform count(*) from public.audit_log;
    raise exception 'Anonymous visitors could read history';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

select 'PASS: full trigger coverage, trusted actors, before/after values, no-op suppression, deletion/cascade history, admin-only RLS, immutability and credential redaction' as verification;
rollback;
