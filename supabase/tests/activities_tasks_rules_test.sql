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

select plan(18);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values
  ('d1111111-1111-4111-8111-111111111111', gen_random_uuid(), 'authenticated', 'authenticated', 'act-coordinator@example.invalid', '', now(), '{}', '{}'),
  ('d2222222-2222-4222-8222-222222222222', gen_random_uuid(), 'authenticated', 'authenticated', 'act-lead@example.invalid', '', now(), '{}', '{}'),
  ('d3333333-3333-4333-8333-333333333333', gen_random_uuid(), 'authenticated', 'authenticated', 'act-assignee@example.invalid', '', now(), '{}', '{}'),
  ('d4444444-4444-4444-8444-444444444444', gen_random_uuid(), 'authenticated', 'authenticated', 'act-other@example.invalid', '', now(), '{}', '{}'),
  ('d5555555-5555-4555-8555-555555555555', gen_random_uuid(), 'authenticated', 'authenticated', 'act-manager@example.invalid', '', now(), '{}', '{}');
update public.memberships set membership_status = 'active', membership_role = case user_id
    when 'd1111111-1111-4111-8111-111111111111' then 'coordinator'
    when 'd5555555-5555-4555-8555-555555555555' then 'club_manager' else 'member' end
where user_id::text like 'd_______-____-4___-8___-____________';

create function pg_temp.act_as(_user uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', _user::text, true),
         set_config('request.jwt.claims', jsonb_build_object('sub', _user, 'session_id', _user, 'role', 'authenticated', 'aal', 'aal2',
           'amr', jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint)))::text, true);
$$;
create function pg_temp.notices(_user uuid, _title text) returns integer language sql security definer as $$
  select count(*)::integer from public.notifications where user_id = _user and title = _title;
$$;
create function pg_temp.task_status() returns text language sql security definer as $$
  select task_status from public.tasks where id = 'd8888888-8888-4888-8888-888888888888';
$$;
grant execute on function pg_temp.notices(uuid, text), pg_temp.task_status() to authenticated;

set local role authenticated;

-- 1. Assigning a lead notifies them.
select pg_temp.act_as('d1111111-1111-4111-8111-111111111111');
insert into public.activities (id, title, slug, lead_id)
values ('d9999999-9999-4999-8999-999999999999', 'Jornada de limpieza', 'jornada-de-limpieza-qa', 'd2222222-2222-4222-8222-222222222222');
select is(pg_temp.notices('d2222222-2222-4222-8222-222222222222', 'Eres responsable de una actividad'), 1, 'the lead is told about their activity');

-- 5. The lead manages the tasks of their activity.
select pg_temp.act_as('d2222222-2222-4222-8222-222222222222');
select lives_ok($$insert into public.tasks (id, title, activity_id, assignee_id, due_at)
  values ('d8888888-8888-4888-8888-888888888888', 'Conseguir bolsas', 'd9999999-9999-4999-8999-999999999999', 'd3333333-3333-4333-8333-333333333333', now() + interval '5 days')$$,
  'a member who leads the activity can create its tasks');
select is(pg_temp.notices('d3333333-3333-4333-8333-333333333333', 'Nueva tarea asignada'), 1, 'the assignee is told about a new task');
select lives_ok($$update public.tasks set title = 'Conseguir bolsas y guantes', priority = 'high' where id = 'd8888888-8888-4888-8888-888888888888'$$,
  'the lead can edit a task of their activity');
select is(pg_temp.notices('d3333333-3333-4333-8333-333333333333', 'Cambio en tu tarea'), 1, 'the assignee is told about a new priority');

select pg_temp.act_as('d4444444-4444-4444-8444-444444444444');
select throws_ok($$insert into public.tasks (title, activity_id) values ('Tarea ajena', 'd9999999-9999-4999-8999-999999999999')$$,
  '42501', null, 'a member who does not lead the activity cannot add tasks');

-- The assignee still only reports progress.
select pg_temp.act_as('d3333333-3333-4333-8333-333333333333');
select throws_ok($$update public.tasks set title = 'Otra cosa' where id = 'd8888888-8888-4888-8888-888888888888'$$,
  '42501', null, 'the assignee cannot rewrite the task');
update public.tasks set task_status = 'blocked' where id = 'd8888888-8888-4888-8888-888888888888';
select is(pg_temp.task_status(), 'blocked', 'the assignee can block the task');

-- 7. Comments.
select lives_ok($$insert into public.task_comments (task_id, body) values ('d8888888-8888-4888-8888-888888888888', 'Bloqueada: falta presupuesto para guantes.')$$,
  'the assignee can comment on their task');
select is(pg_temp.notices('d2222222-2222-4222-8222-222222222222', 'Comentario en una tarea'), 1, 'the lead is told about the comment');
select pg_temp.act_as('d4444444-4444-4444-8444-444444444444');
select throws_ok($$insert into public.task_comments (task_id, body) values ('d8888888-8888-4888-8888-888888888888', 'Opinión ajena.')$$,
  '42501', null, 'members unrelated to the task cannot comment');
select is((select count(*)::integer from public.task_comments where task_id = 'd8888888-8888-4888-8888-888888888888'), 1, 'every active member can read the comments');

-- 4. One reminder the day before.
select pg_temp.act_as('d2222222-2222-4222-8222-222222222222');
update public.tasks set due_at = now() + interval '12 hours' where id = 'd8888888-8888-4888-8888-888888888888';
reset role;
select is(private.send_task_reminders(), 1, 'a task due within a day gets a reminder');
select is(private.send_task_reminders(), 0, 'the reminder is sent once');
select is(pg_temp.notices('d3333333-3333-4333-8333-333333333333', 'Tu tarea vence pronto'), 1, 'the assignee receives the reminder');
set local role authenticated;

-- 3. Closing the activity cancels its open tasks.
select pg_temp.act_as('d1111111-1111-4111-8111-111111111111');
insert into public.events (id, title, slug, starts_at, activity_id)
values ('d7777777-7777-4777-8777-777777777777', 'Jornada de limpieza', 'jornada-de-limpieza-evento-qa', now() + interval '6 days', 'd9999999-9999-4999-8999-999999999999');
update public.activities set activity_status = 'completed' where id = 'd9999999-9999-4999-8999-999999999999';
select is(pg_temp.task_status(), 'cancelled', 'closing the activity cancels its open tasks');

-- 2. Only management deletes; the linked event survives without the link.
delete from public.activities where id = 'd9999999-9999-4999-8999-999999999999';
select is((select count(*)::integer from public.activities where id = 'd9999999-9999-4999-8999-999999999999'), 1, 'coordination cannot delete activities');
select pg_temp.act_as('d5555555-5555-4555-8555-555555555555');
delete from public.activities where id = 'd9999999-9999-4999-8999-999999999999';
select ok((select activity_id is null from public.events where id = 'd7777777-7777-4777-8777-777777777777') and pg_temp.task_status() is null,
  'management deletes the activity and its tasks; the event loses only the link');

reset role;
select * from finish();
rollback;
