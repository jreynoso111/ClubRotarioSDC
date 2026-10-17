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

select plan(20);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values
  ('c1111111-1111-4111-8111-111111111111', gen_random_uuid(), 'authenticated', 'authenticated', 'agenda-coordinator@example.invalid', '', now(), '{}', '{}'),
  ('c2222222-2222-4222-8222-222222222222', gen_random_uuid(), 'authenticated', 'authenticated', 'agenda-editor@example.invalid', '', now(), '{}', '{}'),
  ('c3333333-3333-4333-8333-333333333333', gen_random_uuid(), 'authenticated', 'authenticated', 'agenda-member-a@example.invalid', '', now(), '{}', '{}'),
  ('c4444444-4444-4444-8444-444444444444', gen_random_uuid(), 'authenticated', 'authenticated', 'agenda-member-b@example.invalid', '', now(), '{}', '{}'),
  ('c5555555-5555-4555-8555-555555555555', gen_random_uuid(), 'authenticated', 'authenticated', 'agenda-member-c@example.invalid', '', now(), '{}', '{}');
update public.memberships set membership_status = 'suspended' where user_id::text not like 'c_______-____-4___-8___-____________';
update public.memberships set membership_status = 'active', membership_role = case user_id
    when 'c1111111-1111-4111-8111-111111111111' then 'coordinator'
    when 'c2222222-2222-4222-8222-222222222222' then 'editor' else 'member' end
where user_id::text like 'c_______-____-4___-8___-____________';

create function pg_temp.act_as(_user uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', _user::text, true),
         set_config('request.jwt.claims', jsonb_build_object('sub', _user, 'session_id', _user, 'role', 'authenticated', 'aal', 'aal2',
           'amr', jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint)))::text, true);
$$;
create function pg_temp.notices(_user uuid, _title text) returns integer language sql security definer as $$
  select count(*)::integer from public.notifications where user_id = _user and title = _title;
$$;
create function pg_temp.rsvp(_user uuid) returns text language sql security definer as $$
  select rsvp_status from public.event_rsvps where event_id = 'c9999999-9999-4999-8999-999999999999' and user_id = _user;
$$;
grant execute on function pg_temp.notices(uuid, text), pg_temp.rsvp(uuid) to authenticated;

set local role authenticated;

-- 9. Editors run the magazine, not the agenda.
select pg_temp.act_as('c2222222-2222-4222-8222-222222222222');
select throws_ok($$insert into public.events (title, slug, starts_at, status) values ('Evento del editor', 'evento-del-editor', now() + interval '5 days', 'draft')$$,
  '42501', null, 'an editor cannot create events');

-- 2. Publishing notifies active members.
select pg_temp.act_as('c1111111-1111-4111-8111-111111111111');
insert into public.events (id, title, slug, starts_at, ends_at, capacity, status, venue_name)
values ('c9999999-9999-4999-8999-999999999999', 'Taller de liderazgo', 'taller-de-liderazgo', now() + interval '10 days', now() + interval '10 days 3 hours', 2, 'published', 'Sede');
select is(pg_temp.notices('c3333333-3333-4333-8333-333333333333', 'Nuevo evento en la agenda'), 1, 'members are told about a new event');

-- 3. Capacity and waitlist.
select pg_temp.act_as('c3333333-3333-4333-8333-333333333333');
insert into public.event_rsvps (event_id, user_id, rsvp_status) values ('c9999999-9999-4999-8999-999999999999', auth.uid(), 'going');
select pg_temp.act_as('c4444444-4444-4444-8444-444444444444');
insert into public.event_rsvps (event_id, user_id, rsvp_status) values ('c9999999-9999-4999-8999-999999999999', auth.uid(), 'going');
select pg_temp.act_as('c5555555-5555-4555-8555-555555555555');
insert into public.event_rsvps (event_id, user_id, rsvp_status) values ('c9999999-9999-4999-8999-999999999999', auth.uid(), 'going');
select is(pg_temp.rsvp('c5555555-5555-4555-8555-555555555555'), 'waitlisted', 'a confirmation beyond capacity joins the waitlist');
select is((select going || '/' || waitlisted || '/' || unanswered from public.get_event_attendance_summary(array['c9999999-9999-4999-8999-999999999999'::uuid])),
  '2/1/2', 'occupancy, waitlist and unanswered members are counted');
select is((select attended from public.get_event_attendance_summary(array['c9999999-9999-4999-8999-999999999999'::uuid])), null::integer,
  'attendance statistics are hidden from members');

select pg_temp.act_as('c3333333-3333-4333-8333-333333333333');
update public.event_rsvps set rsvp_status = 'declined' where event_id = 'c9999999-9999-4999-8999-999999999999' and user_id = auth.uid();
select is(pg_temp.rsvp('c5555555-5555-4555-8555-555555555555'), 'going', 'a released seat promotes the first waitlisted member');
select is(pg_temp.notices('c5555555-5555-4555-8555-555555555555', 'Tienes una plaza confirmada'), 1, 'the promoted member is notified');
select ok(not exists (select 1 from public.get_event_attendance(array['c9999999-9999-4999-8999-999999999999'::uuid]) where rsvp_status = 'declined'),
  'declined members are counted, not named');

update public.event_rsvps set rsvp_status = 'waitlisted' where event_id = 'c9999999-9999-4999-8999-999999999999' and user_id = auth.uid();
select is(pg_temp.rsvp('c3333333-3333-4333-8333-333333333333'), 'waitlisted', 'asking to attend a full event joins the waitlist');
select pg_temp.act_as('c1111111-1111-4111-8111-111111111111');
update public.events set capacity = 3 where id = 'c9999999-9999-4999-8999-999999999999';
select is(pg_temp.rsvp('c3333333-3333-4333-8333-333333333333'), 'going', 'more capacity promotes the waitlist');

-- 2. Changes and cancellation notify respondents only.
update public.events set starts_at = starts_at + interval '1 day', ends_at = ends_at + interval '1 day' where id = 'c9999999-9999-4999-8999-999999999999';
select is(pg_temp.notices('c4444444-4444-4444-8444-444444444444', 'Cambio en un evento'), 1, 'respondents are told about a new date');
select is(pg_temp.notices('c2222222-2222-4222-8222-222222222222', 'Cambio en un evento'), 0, 'members who did not respond are not notified');
update public.events set status = 'cancelled' where id = 'c9999999-9999-4999-8999-999999999999';
select is(pg_temp.notices('c4444444-4444-4444-8444-444444444444', 'Evento cancelado'), 1, 'respondents are told about a cancellation');

-- 1. A cancelled event stays visible but closed.
select pg_temp.act_as('c4444444-4444-4444-8444-444444444444');
select is((select status from public.events where id = 'c9999999-9999-4999-8999-999999999999'), 'cancelled', 'members still see the cancelled event');
select pg_temp.act_as('c2222222-2222-4222-8222-222222222222');
select throws_ok($$insert into public.event_rsvps (event_id, user_id, rsvp_status) values ('c9999999-9999-4999-8999-999999999999', auth.uid(), 'going')$$,
  '42501', null, 'nobody can confirm a cancelled event');

-- 8. Actual attendance after the event.
select pg_temp.act_as('c1111111-1111-4111-8111-111111111111');
insert into public.events (id, title, slug, starts_at, status) values ('c8888888-8888-4888-8888-888888888888', 'Reunión pasada', 'reunion-pasada', now() - interval '2 days', 'published');
select throws_ok($$insert into public.event_attendance (event_id, user_id) values ('c9999999-9999-4999-8999-999999999999', 'c4444444-4444-4444-8444-444444444444')$$,
  '42501', null, 'attendance cannot be recorded for an event that has not happened');
select lives_ok($$insert into public.event_attendance (event_id, user_id) values ('c8888888-8888-4888-8888-888888888888', 'c4444444-4444-4444-8444-444444444444')$$,
  'coordination records who attended a past event');
select is((select attended from public.get_event_attendance_summary(array['c8888888-8888-4888-8888-888888888888'::uuid])), 1, 'coordination sees the attendance count');
select pg_temp.act_as('c4444444-4444-4444-8444-444444444444');
select is((select count(*)::integer from public.event_attendance), 1, 'a member sees their own attendance');
select pg_temp.act_as('c5555555-5555-4555-8555-555555555555');
select is((select count(*)::integer from public.event_attendance), 0, 'a member cannot see others'' attendance');

reset role;
select * from finish();
rollback;
