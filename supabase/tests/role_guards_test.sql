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

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values
  ('a1111111-1111-4111-8111-111111111111', gen_random_uuid(), 'authenticated', 'authenticated', 'guard-admin@example.invalid', '', now(), '{}', '{}'),
  ('a2222222-2222-4222-8222-222222222222', gen_random_uuid(), 'authenticated', 'authenticated', 'guard-manager@example.invalid', '', now(), '{}', '{}'),
  ('a3333333-3333-4333-8333-333333333333', gen_random_uuid(), 'authenticated', 'authenticated', 'guard-coordinator@example.invalid', '', now(), '{}', '{}'),
  ('a4444444-4444-4444-8444-444444444444', gen_random_uuid(), 'authenticated', 'authenticated', 'guard-member@example.invalid', '', now(), '{}', '{}'),
  ('a5555555-5555-4555-8555-555555555555', gen_random_uuid(), 'authenticated', 'authenticated', 'guard-other@example.invalid', '', now(), '{}', '{}'),
  ('a6666666-6666-4666-8666-666666666666', gen_random_uuid(), 'authenticated', 'authenticated', 'guard-pending@example.invalid', '', now(), '{}', '{}');
update public.memberships set membership_status = case when user_id = 'a6666666-6666-4666-8666-666666666666' then 'pending' else 'active' end,
  membership_role = case user_id
    when 'a1111111-1111-4111-8111-111111111111' then 'admin'
    when 'a2222222-2222-4222-8222-222222222222' then 'club_manager'
    when 'a3333333-3333-4333-8333-333333333333' then 'coordinator'
    else 'member' end
where user_id::text like 'a_______-____-4___-8___-____________';

insert into public.activities (id, title, slug) values ('a7777777-7777-4777-8777-777777777777', 'Actividad guardia', 'actividad-guardia');
insert into public.tasks (id, title, activity_id, assignee_id)
values ('a8888888-8888-4888-8888-888888888888', 'Tarea guardia', 'a7777777-7777-4777-8777-777777777777', 'a4444444-4444-4444-8444-444444444444');
insert into public.proposals (id, title, summary, status, created_by) values
  ('a9999999-9999-4999-8999-999999999999', 'Propuesta guardia', 'Resumen suficiente de la propuesta', 'draft', 'a4444444-4444-4444-8444-444444444444'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Propuesta pendiente', 'Resumen suficiente de la propuesta', 'draft', 'a6666666-6666-4666-8666-666666666666');

create function pg_temp.act_as(_user uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', _user::text, true),
         set_config('request.jwt.claims', jsonb_build_object('sub', _user, 'session_id', _user, 'role', 'authenticated', 'aal', 'aal2',
           'amr', jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint)))::text, true);
$$;

set local role authenticated;

-- Member: author and assignee without coordination rights.
select pg_temp.act_as('a4444444-4444-4444-8444-444444444444');
select lives_ok($$update public.proposals set title = 'Propuesta guardia editada' where id = 'a9999999-9999-4999-8999-999999999999'$$,
  'an author can still edit their own draft');
select throws_ok($$update public.proposals set status = 'submitted', voting_open = true where id = 'a9999999-9999-4999-8999-999999999999'$$,
  '42501', null, 'an author cannot open the ballot of their own proposal');
select throws_ok($$update public.proposals set status = 'submitted', reviewed_by = auth.uid(), reviewed_at = now(), review_notes = 'Autoaprobada' where id = 'a9999999-9999-4999-8999-999999999999'$$,
  '42501', null, 'an author cannot record a review of their own proposal');
select lives_ok($$select public.submit_proposal('a9999999-9999-4999-8999-999999999999')$$,
  'an author can still submit through submit_proposal');
select throws_ok($$update public.tasks set title = 'Otra tarea', due_at = now() - interval '1 year' where id = 'a8888888-8888-4888-8888-888888888888'$$,
  '42501', null, 'an assignee cannot rewrite the task definition');
select lives_ok($$update public.tasks set task_status = 'done', completed_at = now() where id = 'a8888888-8888-4888-8888-888888888888'$$,
  'an assignee can still report progress');
select is((select task_status from public.tasks where id = 'a8888888-8888-4888-8888-888888888888'), 'done', 'the progress update was stored');
select lives_ok($$update public.profiles set bio = 'Mi biografía' where id = auth.uid()$$, 'a member can still update their own profile');

-- Pending account cannot keep working on proposals.
select pg_temp.act_as('a6666666-6666-4666-8666-666666666666');
select throws_ok($$update public.proposals set status = 'submitted' where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$,
  '42501', null, 'a pending author cannot submit or change a proposal');

-- Coordinator keeps full task management.
select pg_temp.act_as('a3333333-3333-4333-8333-333333333333');
select lives_ok($$update public.tasks set title = 'Tarea guardia revisada' where id = 'a8888888-8888-4888-8888-888888888888'$$,
  'coordination can still edit a task definition');

-- Club management cannot escalate or touch administrators.
select pg_temp.act_as('a2222222-2222-4222-8222-222222222222');
select throws_ok($$update public.memberships set membership_role = 'admin' where user_id = 'a5555555-5555-4555-8555-555555555555'$$,
  '42501', null, 'club management cannot grant administration');
select throws_ok($$update public.memberships set membership_role = 'club_manager' where user_id = 'a5555555-5555-4555-8555-555555555555'$$,
  '42501', null, 'club management cannot promote someone to club management');
select throws_ok($$update public.memberships set membership_role = 'admin' where user_id = auth.uid()$$,
  '42501', null, 'club management cannot promote itself');
select throws_ok($$update public.memberships set membership_status = 'suspended' where user_id = 'a1111111-1111-4111-8111-111111111111'$$,
  '42501', null, 'club management cannot suspend an administrator');
select throws_ok($$update public.profiles set display_name = 'Renombrado' where id = 'a1111111-1111-4111-8111-111111111111'$$,
  '42501', null, 'club management cannot rewrite an administrator profile');
select lives_ok($$update public.memberships set membership_role = 'coordinator' where user_id = 'a5555555-5555-4555-8555-555555555555'$$,
  'club management can still assign ordinary roles');
select lives_ok($$update public.profiles set display_name = 'Miembro renombrado' where id = 'a5555555-5555-4555-8555-555555555555'$$,
  'club management can still edit ordinary member profiles');

-- Administrators keep full control except over their own access.
select pg_temp.act_as('a1111111-1111-4111-8111-111111111111');
select lives_ok($$update public.memberships set membership_role = 'club_manager' where user_id = 'a5555555-5555-4555-8555-555555555555'$$,
  'an administrator can still assign club management');
select throws_ok($$update public.memberships set membership_role = 'member' where user_id = auth.uid()$$,
  '42501', null, 'an administrator cannot change their own access');

reset role;
select * from finish();
rollback;
