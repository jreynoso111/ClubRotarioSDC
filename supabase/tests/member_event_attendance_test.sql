begin;

select plan(5);

create temporary table event_attendance_fixture (
  going_id uuid not null,
  maybe_id uuid not null,
  declined_id uuid not null,
  suspended_id uuid not null,
  published_event uuid not null,
  draft_event uuid not null
);

insert into event_attendance_fixture
values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid());

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select fixture_id, gen_random_uuid(), 'authenticated', 'authenticated',
       fixture_id::text || '@event-attendance.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
from (
  select going_id as fixture_id from event_attendance_fixture
  union all select maybe_id from event_attendance_fixture
  union all select declined_id from event_attendance_fixture
  union all select suspended_id from event_attendance_fixture
) as fixtures;

update public.profiles set display_name = 'Asistente de prueba'
where id in (select going_id from event_attendance_fixture union all select maybe_id from event_attendance_fixture
  union all select declined_id from event_attendance_fixture union all select suspended_id from event_attendance_fixture);

update public.memberships
set membership_role = 'member',
    membership_status = case when user_id = (select suspended_id from event_attendance_fixture) then 'suspended' else 'active' end
where user_id in (select going_id from event_attendance_fixture union all select maybe_id from event_attendance_fixture
  union all select declined_id from event_attendance_fixture union all select suspended_id from event_attendance_fixture);

insert into public.events (id, title, slug, starts_at, status)
select published_event, 'Encuentro publicado', 'encuentro-asistencia-' || left(md5(published_event::text), 8), now() + interval '3 days', 'published'
from event_attendance_fixture
union all
select draft_event, 'Encuentro en borrador', 'borrador-asistencia-' || left(md5(draft_event::text), 8), now() + interval '3 days', 'draft'
from event_attendance_fixture;

insert into public.event_rsvps (event_id, user_id, rsvp_status)
select published_event, going_id, 'going' from event_attendance_fixture
union all select published_event, maybe_id, 'maybe' from event_attendance_fixture
union all select published_event, declined_id, 'declined' from event_attendance_fixture
union all select draft_event, going_id, 'going' from event_attendance_fixture;

grant select on event_attendance_fixture to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', (select declined_id::text from event_attendance_fixture), true);

select is(
  (select count(*)::integer from public.get_event_attendance(array[(select published_event from event_attendance_fixture)])),
  2,
  'an active member sees going and maybe answers for a published event'
);

select is(
  (select count(*)::integer from public.get_event_attendance(array[(select published_event from event_attendance_fixture)])
   where rsvp_status = 'declined'),
  0,
  'declined answers are not exposed to members'
);

select is(
  (select count(*)::integer from public.get_event_attendance(array[(select draft_event from event_attendance_fixture)])),
  0,
  'draft events expose no attendance to members'
);

select is(
  (select count(*)::integer from public.event_rsvps where event_id = (select published_event from event_attendance_fixture)),
  1,
  'direct table access still shows a member only their own answer'
);

select set_config('request.jwt.claim.sub', (select suspended_id::text from event_attendance_fixture), true);
select throws_ok(
  format('select * from public.get_event_attendance(array[%L::uuid])', (select published_event from event_attendance_fixture)),
  '42501',
  'suspended members cannot read event attendance'
);

reset role;
select * from finish();
rollback;
