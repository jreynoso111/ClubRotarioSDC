begin;
select plan(13);

create temporary table committee_flow_fixture (admin_id uuid, member_id uuid,
  manager_id uuid, suspended_id uuid, committee_id uuid);
insert into committee_flow_fixture values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), null);
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select fixture_id, gen_random_uuid(), 'authenticated', 'authenticated',
  fixture_id::text || '@committee-flow.example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
from (select admin_id as fixture_id from committee_flow_fixture
  union all select member_id from committee_flow_fixture union all select manager_id from committee_flow_fixture
  union all select suspended_id from committee_flow_fixture) fixtures;
update public.memberships set membership_status = 'active', membership_role = case
  when user_id = (select admin_id from committee_flow_fixture) then 'admin'
  when user_id = (select manager_id from committee_flow_fixture) then 'club_manager' else 'member' end
where user_id in (select admin_id from committee_flow_fixture union all select member_id from committee_flow_fixture
  union all select manager_id from committee_flow_fixture);
update public.memberships set membership_status = 'suspended', membership_role = 'admin'
where user_id = (select suspended_id from committee_flow_fixture);
grant select, update on committee_flow_fixture to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', (select admin_id::text from committee_flow_fixture), true);
select lives_ok($$update committee_flow_fixture set committee_id = public.create_committee_with_members(
  'Comite temporal', 'committee-flow-' || admin_id::text, 'Solo durante la verificacion',
  array[admin_id, member_id], array['chair', 'secretary'])$$,
  'an active admin creates the committee and its initial roster atomically');
select is((select count(*)::integer from public.committee_members
  where committee_id = (select committee_id from committee_flow_fixture)), 2,
  'both initial assignments are persisted');
select ok((select created_by = (select admin_id from committee_flow_fixture)
  from public.committees where id = (select committee_id from committee_flow_fixture)),
  'committee creation stores the authenticated administrator');
select throws_ok($$select public.create_committee_with_members('Duplicados',
  'committee-duplicates-' || admin_id::text, null, array[member_id, member_id], array['member', 'chair'])
  from committee_flow_fixture$$, '22023', null, 'a roster cannot contain a member twice');
select throws_ok($$select public.create_committee_with_members('Suspendidos',
  'committee-suspended-' || admin_id::text, null, array[suspended_id], array['member'])
  from committee_flow_fixture$$, '22023', null, 'suspended members cannot join a new committee');

select set_config('request.jwt.claim.sub', (select manager_id::text from committee_flow_fixture), true);
select throws_ok($$select public.create_committee_with_members('No autorizado',
  'committee-manager-' || manager_id::text, null, '{}'::uuid[], '{}'::text[]) from committee_flow_fixture$$,
  '42501', null, 'club managers cannot create committees');
select set_config('request.jwt.claim.sub', (select member_id::text from committee_flow_fixture), true);
select throws_ok($$select public.create_committee_with_members('No autorizado',
  'committee-member-' || member_id::text, null, '{}'::uuid[], '{}'::text[]) from committee_flow_fixture$$,
  '42501', null, 'regular members cannot create committees');
select set_config('request.jwt.claim.sub', (select suspended_id::text from committee_flow_fixture), true);
select throws_ok($$select public.create_committee_with_members('No autorizado',
  'committee-inactive-' || suspended_id::text, null, '{}'::uuid[], '{}'::text[]) from committee_flow_fixture$$,
  '42501', null, 'suspended administrators lose committee management access');

select set_config('request.jwt.claim.sub', (select admin_id::text from committee_flow_fixture), true);
update public.committee_members set committee_role = 'treasurer'
where committee_id = (select committee_id from committee_flow_fixture)
  and user_id = (select member_id from committee_flow_fixture);
select is((select committee_role from public.committee_members
  where committee_id = (select committee_id from committee_flow_fixture)
    and user_id = (select member_id from committee_flow_fixture)), 'treasurer',
  'an administrator can change an active committee responsibility');
update public.committees set is_active = false, updated_by = auth.uid()
where id = (select committee_id from committee_flow_fixture);
select ok((select not is_active from public.committees where id = (select committee_id from committee_flow_fixture))
  and (select count(*) = 2 from public.committee_members where committee_id = (select committee_id from committee_flow_fixture)),
  'completion retains the archived committee and its complete roster');
with updated as (update public.committee_members set committee_role = 'member'
  where committee_id = (select committee_id from committee_flow_fixture) returning user_id)
select is(count(*)::integer, 0, 'an archived roster cannot be edited') from updated;
select ok(exists (select 1 from public.audit_log where table_name = 'committees'
  and record_id = (select committee_id::text from committee_flow_fixture)
  and actor_id = (select admin_id from committee_flow_fixture)
  and before_data->>'is_active' = 'true' and after_data->>'is_active' = 'false'),
  'committee completion retains an actor-attributed before and after audit record');
select set_config('request.jwt.claim.sub', (select member_id::text from committee_flow_fixture), true);
select is((select count(*)::integer from public.committees where id = (select committee_id from committee_flow_fixture)), 0,
  'regular members do not see completed committee archives');
reset role;

select * from finish();
rollback;
