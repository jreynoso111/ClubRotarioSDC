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

select set_config('request.jwt.claims', jsonb_build_object('aal', 'aal2', 'amr', jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint)))::text, true); -- privileged fixtures act with a recent second factor (privileged_mfa_test.sql covers its absence)
select plan(18);

select ok(
  to_regclass('public.membership_applications') is not null,
  'the membership application table exists'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.membership_applications'::regclass),
  'membership application rows are protected by RLS'
);
select ok(
  not has_table_privilege('anon', 'public.membership_applications', 'INSERT')
    and has_function_privilege('anon', 'public.submit_membership_application(text,text,text,text,text,text,boolean)', 'EXECUTE')
    and not has_table_privilege('anon', 'public.membership_applications', 'SELECT')
    and not has_table_privilege('anon', 'public.membership_applications', 'UPDATE')
    and not has_table_privilege('anon', 'public.membership_applications', 'DELETE'),
  'anonymous visitors submit only through the throttled intake function and cannot read or change applications'
);
select ok(
  has_table_privilege('authenticated', 'public.membership_applications', 'SELECT')
    and not has_any_column_privilege('authenticated', 'public.membership_applications', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.membership_applications', 'DELETE'),
  'signed-in users can read rows but hold no UPDATE privilege on the table or any column, and no DELETE'
);
select ok(
  exists (select 1 from pg_policies
    where schemaname = 'public' and tablename = 'membership_applications'
      and policyname = 'membership_applications_read_management' and cmd = 'SELECT')
  and not exists (select 1 from pg_policies
    where schemaname = 'public' and tablename = 'membership_applications'
      and policyname in ('membership_applications_read_active_members', 'membership_applications_review_management'))
  and not exists (select 1 from pg_policies
    where schemaname = 'public' and tablename = 'membership_applications' and cmd = 'INSERT'),
  'only management has a read policy, the member read and review policies are gone, and no direct INSERT policy remains'
);
select ok(
  exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'membership_applications_one_open_request_per_email'),
  'duplicate open requests for the same email are constrained'
);
select ok(
  exists (select 1 from pg_trigger
    where tgrelid = 'public.membership_applications'::regclass
      and tgname = 'zz_club_audit' and not tgisinternal),
  'new and reviewed applications enter the club audit trail'
);

create temporary table application_fixture (
  member_id uuid not null,
  manager_id uuid not null,
  pending_id uuid not null,
  suspended_id uuid not null,
  application_id uuid
);
insert into application_fixture values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), null);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select fixture_id, gen_random_uuid(), 'authenticated', 'authenticated',
       fixture_id::text || '@application-test.example', '', now(), '{}'::jsonb, '{}'::jsonb,
       now(), now()
from (
  select member_id as fixture_id from application_fixture
  union all select manager_id from application_fixture
  union all select pending_id from application_fixture
  union all select suspended_id from application_fixture
) as fixture_users;

update public.memberships
set membership_status = 'active', joined_at = now()
where user_id in ((select member_id from application_fixture), (select manager_id from application_fixture));
update public.memberships
set membership_role = 'club_manager'
where user_id = (select manager_id from application_fixture);
update public.memberships
set membership_status = 'suspended'
where user_id = (select suspended_id from application_fixture);

set local role anon;
select set_config('request.jwt.claim.role', 'anon', true);
select lives_ok($$
  select public.submit_membership_application(
    'Persona Interesada', 'persona@example.org', '+1 809 555 0123', null,
    'Quiero aportar tiempo y experiencia a las causas locales.', null, true
  )
$$, 'anonymous applicant can submit the required fields');
select throws_ok($$
  select public.submit_membership_application(
    'Sin Consentimiento', 'no-consent@example.org', '+1 809 555 0144', null,
    'Quiero conocer más sobre el servicio rotario.', null, false
  )
$$, '42501', null, 'intake rejects submissions without member-sharing consent');
select throws_ok(
  'select count(*) from public.membership_applications',
  '42501', null,
  'anonymous visitors cannot read applicant contact details'
);
reset role;

update application_fixture
set application_id = (select id from public.membership_applications where email = 'persona@example.org');
grant select on application_fixture to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', (select member_id::text from application_fixture), true);
select set_config('request.jwt.claims', (coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb || jsonb_build_object('session_id', auth.uid()))::text, true);
select is(
  (select count(*)::integer from public.membership_applications),
  0,
  'an active member selecting the table directly sees no rows; applications are read through the list function'
);
select throws_ok($$select public.review_membership_application((select application_id from application_fixture), 'contacted', null, now())$$,
  '42501', null, 'a regular member cannot change review status through the review function');
select set_config('request.jwt.claim.sub', (select manager_id::text from application_fixture), true);
select set_config('request.jwt.claims', (coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb || jsonb_build_object('session_id', auth.uid()))::text, true);
select throws_ok($$
  update public.membership_applications
  set status = 'contacted', reviewed_by = auth.uid()
  where id = (select application_id from application_fixture)
$$, '42501', null, 'a club manager cannot update applications directly, even with a recent second factor');
select lives_ok($$select public.review_membership_application((select application_id from application_fixture), 'contacted', null,
  (select updated_at from public.membership_applications where id = (select application_id from application_fixture)))$$,
  'an active club manager can update the review status through the review function');
select is(
  (select reviewed_by from public.membership_applications where id = (select application_id from application_fixture)),
  (select manager_id from application_fixture),
  'review changes are attributed to the authenticated manager'
);
select set_config('request.jwt.claim.sub', (select pending_id::text from application_fixture), true);
select set_config('request.jwt.claims', (coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb || jsonb_build_object('session_id', auth.uid()))::text, true);
select is(
  (select count(*)::integer from public.membership_applications),
  0,
  'pending accounts cannot see applicant data'
);
select set_config('request.jwt.claim.sub', (select suspended_id::text from application_fixture), true);
select set_config('request.jwt.claims', (coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb || jsonb_build_object('session_id', auth.uid()))::text, true);
select is(
  (select count(*)::integer from public.membership_applications),
  0,
  'suspended accounts cannot see applicant data'
);

reset role;
select ok(
  exists (select 1 from public.audit_log
    where table_name = 'membership_applications'
      and record_id = (select application_id::text from application_fixture)
      and actor_id is null
      and before_data is null and after_data is not null)
  and exists (select 1 from public.audit_log
    where table_name = 'membership_applications'
      and record_id = (select application_id::text from application_fixture)
      and actor_id = (select manager_id from application_fixture)
      and before_data is not null and after_data is not null),
  'application creation and review are audited without exposing them publicly'
);

select * from finish();
rollback;
