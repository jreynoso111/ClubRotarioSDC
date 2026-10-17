begin;

-- Synthetic sessions belong only to users inserted by this rolled-back suite.
create function pg_temp.club_fixture_session() returns trigger language plpgsql as $$
begin
  insert into auth.sessions(id, user_id, created_at, updated_at, aal)
  values(new.id, new.id, now(), now(), 'aal2');
  return new;
end; $$;
create trigger club_fixture_session after insert on auth.users
for each row execute function pg_temp.club_fixture_session();

select plan(19);

-- Fixtures: one user per role. All memberships are active.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values
  ('f1111111-1111-4111-8111-111111111111', gen_random_uuid(), 'authenticated', 'authenticated', 'mfa-admin@example.invalid', '', now(), '{}', '{}'),
  ('f2222222-2222-4222-8222-222222222222', gen_random_uuid(), 'authenticated', 'authenticated', 'mfa-manager@example.invalid', '', now(), '{}', '{}'),
  ('f3333333-3333-4333-8333-333333333333', gen_random_uuid(), 'authenticated', 'authenticated', 'mfa-editor@example.invalid', '', now(), '{}', '{}'),
  ('f4444444-4444-4444-8444-444444444444', gen_random_uuid(), 'authenticated', 'authenticated', 'mfa-member@example.invalid', '', now(), '{}', '{}');
update public.memberships set membership_status = 'active', membership_role = case user_id
  when 'f1111111-1111-4111-8111-111111111111' then 'admin'
  when 'f2222222-2222-4222-8222-222222222222' then 'club_manager'
  when 'f3333333-3333-4333-8333-333333333333' then 'editor'
  else 'member' end
where user_id in ('f1111111-1111-4111-8111-111111111111', 'f2222222-2222-4222-8222-222222222222',
                  'f3333333-3333-4333-8333-333333333333', 'f4444444-4444-4444-8444-444444444444');

create temporary table mfa_claims (label text primary key, claims jsonb not null);
insert into mfa_claims values
  ('password', jsonb_build_object('aal', 'aal1', 'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint)))),
  ('aal2_password_only', jsonb_build_object('aal', 'aal2', 'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint)))),
  ('stale_totp', jsonb_build_object('aal', 'aal2', 'amr', jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now() - interval '13 hours')::bigint)))),
  ('fresh_totp', jsonb_build_object('aal', 'aal2', 'amr', jsonb_build_array(
    jsonb_build_object('method', 'password', 'timestamp', extract(epoch from now() - interval '1 hour')::bigint),
    jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now() - interval '5 minutes')::bigint)))),
  ('malformed', '{"aal":"aal2","amr":"totp"}'::jsonb),
  ('forged_aal1_totp', jsonb_build_object('aal', 'aal1', 'amr', jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint))));
grant select on mfa_claims to authenticated;

create function pg_temp.act_as(_user uuid, _label text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', _user::text, true),
         set_config('request.jwt.claims', (select claims || jsonb_build_object('session_id', _user, 'sub', _user, 'role', 'authenticated') from mfa_claims where label = _label)::text, true);
select set_config('request.jwt.claims', (coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb || jsonb_build_object('session_id', auth.uid()))::text, true);
$$;

select ok(
  not has_function_privilege('anon', 'private.has_recent_second_factor()', 'EXECUTE'),
  'anonymous clients cannot call the second-factor check'
);

set local role authenticated;

select pg_temp.act_as('f1111111-1111-4111-8111-111111111111', 'password');
select ok(not private.has_any_role(array['admin']), 'admin with password only is not treated as admin');
select ok(private.is_active_member(), 'admin with password only still keeps ordinary member access');
select is((select count(*)::integer from public.memberships), 1, 'admin with password only reads only its own membership');
update public.memberships set membership_role = 'admin' where user_id = 'f4444444-4444-4444-8444-444444444444';

select pg_temp.act_as('f1111111-1111-4111-8111-111111111111', 'aal2_password_only');
select ok(not private.has_any_role(array['admin']), 'an aal2 claim without a second-factor method is rejected');

select pg_temp.act_as('f1111111-1111-4111-8111-111111111111', 'stale_totp');
select ok(not private.has_any_role(array['admin']), 'a second factor older than 12 hours is insufficient');

select pg_temp.act_as('f1111111-1111-4111-8111-111111111111', 'malformed');
select ok(not private.has_any_role(array['admin']), 'malformed amr claims fail closed without errors');

select pg_temp.act_as('f1111111-1111-4111-8111-111111111111', 'forged_aal1_totp');
select ok(not private.has_any_role(array['admin']), 'an amr entry without aal2 is insufficient');

select pg_temp.act_as('f1111111-1111-4111-8111-111111111111', 'fresh_totp');
select ok(private.has_any_role(array['admin']), 'admin with a recent second factor keeps admin access');
select ok((select count(*) from public.memberships) >= 4, 'admin with a recent second factor can review memberships');

select pg_temp.act_as('f2222222-2222-4222-8222-222222222222', 'password');
select throws_ok(
  $$select public.create_finance_entry('income', 'donation', 10.00, (now() at time zone 'America/Santo_Domingo')::date, 'Prueba MFA', null, null, null, 'cash', null)$$,
  '42501',
  null,
  'club manager with password only cannot record finances'
);
update public.memberships set membership_status = 'suspended' where user_id = 'f4444444-4444-4444-8444-444444444444';

select pg_temp.act_as('f2222222-2222-4222-8222-222222222222', 'fresh_totp');
select lives_ok(
  $$select public.create_finance_entry('income', 'donation', 10.00, (now() at time zone 'America/Santo_Domingo')::date, 'Prueba MFA', null, null, null, 'cash', null)$$,
  'club manager with a recent second factor can record finances'
);

select pg_temp.act_as('f3333333-3333-4333-8333-333333333333', 'password');
select ok(private.has_any_role(array['editor', 'club_manager', 'admin']), 'editor role is unchanged by the privileged MFA rule');

select pg_temp.act_as('f4444444-4444-4444-8444-444444444444', 'password');
select ok(private.has_any_role(array['member']) and private.is_active_member(), 'ordinary members keep their access with a password');

reset role;
select is(
  (select membership_role || '/' || membership_status from public.memberships where user_id = 'f4444444-4444-4444-8444-444444444444'),
  'member/active',
  'password-only admin and manager updates did not escalate or suspend the member'
);

set local role authenticated;
select pg_temp.act_as('f1111111-1111-4111-8111-111111111111', 'fresh_totp');
select ok(public.has_privileged_session(), 'web session check and database agree for a live session');
reset role;
update auth.sessions set not_after = now() - interval '1 second'
where user_id = 'f1111111-1111-4111-8111-111111111111';
set local role authenticated;
select ok(not private.has_any_role(array['admin']), 'expired live session cannot administer using an unexpired JWT');
reset role;
update auth.sessions set not_after = null, created_at = now() - interval '25 hours'
where user_id = 'f1111111-1111-4111-8111-111111111111';
set local role authenticated;
select ok(not public.has_privileged_session(), 'a session older than 24 hours needs a new login');
reset role;
delete from auth.sessions where user_id = 'f1111111-1111-4111-8111-111111111111';
set local role authenticated;
select ok(not private.has_any_role(array['admin']) and not public.has_privileged_session(), 'logout revokes administration immediately despite the JWT lifetime');
reset role;

select * from finish();
rollback;
