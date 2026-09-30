begin;
select plan(17);

select ok(
  to_regclass('public.membership_applications') is not null,
  'the membership application table exists'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.membership_applications'::regclass),
  'membership application rows are protected by RLS'
);
select ok(
  has_column_privilege('anon', 'public.membership_applications', 'full_name', 'INSERT')
    and has_column_privilege('anon', 'public.membership_applications', 'consented_to_member_sharing', 'INSERT')
    and not has_table_privilege('anon', 'public.membership_applications', 'SELECT')
    and not has_table_privilege('anon', 'public.membership_applications', 'UPDATE')
    and not has_table_privilege('anon', 'public.membership_applications', 'DELETE'),
  'anonymous visitors can submit but cannot read or change applications'
);
select ok(
  has_table_privilege('authenticated', 'public.membership_applications', 'SELECT')
    and has_column_privilege('authenticated', 'public.membership_applications', 'status', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.membership_applications', 'DELETE'),
  'members can read rows and management roles have only scoped update columns'
);
select is(
  (select count(*)::integer from pg_policies
   where schemaname = 'public'
     and tablename = 'membership_applications'
     and policyname in (
       'membership_applications_submit',
       'membership_applications_read_active_members',
       'membership_applications_review_management'
     )),
  3,
  'submission, active-member read, and management review have separate policies'
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
  insert into public.membership_applications (
    full_name, email, phone, motivation, consented_to_member_sharing
  ) values (
    'Persona Interesada', 'persona@example.org', '+1 809 555 0123',
    'Quiero aportar tiempo y experiencia a las causas locales.', true
  )
$$, 'anonymous applicant can submit the required fields');
select throws_ok($$
  insert into public.membership_applications (
    full_name, email, phone, motivation, consented_to_member_sharing
  ) values (
    'Sin Consentimiento', 'no-consent@example.org', '+1 809 555 0144',
    'Quiero conocer más sobre el servicio rotario.', false
  )
$$, '42501', null, 'RLS rejects submissions without member-sharing consent');
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
select is(
  (select count(*)::integer from public.membership_applications),
  1,
  'an active member can see the submitted application'
);
with updated as (
  update public.membership_applications
  set status = 'contacted', reviewed_by = auth.uid()
  where id = (select application_id from application_fixture)
  returning id
)
select is(
  count(*)::integer,
  0,
  'a regular member can see an application but cannot change its review status'
) from updated;
select set_config('request.jwt.claim.sub', (select manager_id::text from application_fixture), true);
select lives_ok($$
  update public.membership_applications
  set status = 'contacted', reviewed_by = auth.uid()
  where id = (select application_id from application_fixture)
$$, 'an active club manager can update the review status');
select is(
  (select reviewed_by from public.membership_applications where id = (select application_id from application_fixture)),
  (select manager_id from application_fixture),
  'review changes are attributed to the authenticated manager'
);
select set_config('request.jwt.claim.sub', (select pending_id::text from application_fixture), true);
select is(
  (select count(*)::integer from public.membership_applications),
  0,
  'pending accounts cannot see applicant data'
);
select set_config('request.jwt.claim.sub', (select suspended_id::text from application_fixture), true);
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
