-- Agenda rules agreed with the club (2026-10-17):
-- 1. A cancelled event stays visible as cancelled (members and public link).
-- 2. Members are notified when an event is published; respondents when it is
--    cancelled or its date or place changes.
-- 3. Capacity is enforced with an automatic waitlist that advances when a
--    confirmed member steps back or capacity grows.
-- 4/5. Everyone sees occupancy; names only for confirmed, waitlisted and
--    undecided members, counts for declined and unanswered.
-- 8. Coordination records who actually attended past events.
-- 9. Coordination publishes events; editors no longer manage the agenda.

-- 9. Events belong to coordination and management.
drop policy events_content_select on public.events;
create policy events_content_select on public.events for select to authenticated
using ((select private.has_any_role(array['coordinator', 'club_manager', 'admin'])));
drop policy events_content_insert on public.events;
create policy events_content_insert on public.events for insert to authenticated
with check ((select private.has_any_role(array['coordinator', 'club_manager', 'admin'])));
drop policy events_content_update on public.events;
create policy events_content_update on public.events for update to authenticated
using ((select private.has_any_role(array['coordinator', 'club_manager', 'admin'])))
with check ((select private.has_any_role(array['coordinator', 'club_manager', 'admin'])));

-- 1. Cancelled events remain visible.
drop policy events_member_select on public.events;
create policy events_member_select on public.events for select to authenticated
using (status in ('published', 'cancelled') and (select private.is_active_member()));
drop policy events_public_select on public.events;
create policy events_public_select on public.events for select to anon, authenticated
using (status in ('published', 'cancelled') and is_public = true);

-- 3. Waitlist.
alter table public.event_rsvps drop constraint event_rsvps_status_check;
alter table public.event_rsvps add constraint event_rsvps_status_check
  check (rsvp_status in ('going', 'maybe', 'declined', 'waitlisted'));
alter table public.event_rsvps add column waitlisted_at timestamptz;

create or replace function private.notify_event_users(_users uuid[], _title text, _body text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, kind, title, body, href)
  select distinct recipient, 'event', left(_title, 180), left(_body, 1000), '/plataforma?tab=agenda'
  from unnest(_users) as recipient
  where recipient is not null and recipient is distinct from (select auth.uid());
$$;

create or replace function private.event_label(_event public.events)
returns text
language sql
stable
set search_path = ''
as $$
  select format('«%s» · %s%s', left(_event.title, 110),
    to_char(_event.starts_at at time zone 'America/Santo_Domingo', 'DD/MM/YY HH24:MI'),
    coalesce(' · ' || nullif(btrim(concat_ws(' · ', _event.venue_name, _event.venue_address)), ''), ''));
$$;

-- BEFORE INSERT/UPDATE: the database decides between going and waitlisted.
create or replace function private.event_rsvp_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  seats integer;
  taken integer;
begin
  -- Clients only ask to attend; a waitlist place is assigned here.
  if new.rsvp_status = 'waitlisted' then
    new.rsvp_status := 'going';
  end if;
  if new.rsvp_status = 'going' and (tg_op = 'INSERT' or old.rsvp_status is distinct from 'going') then
    select capacity into seats from public.events where id = new.event_id for update;
    if seats is not null then
      select count(*) into taken from public.event_rsvps
      where event_id = new.event_id and rsvp_status = 'going' and user_id <> new.user_id;
      if taken >= seats then
        new.rsvp_status := 'waitlisted';
      end if;
    end if;
  end if;
  -- Keep the queue position of someone already waiting.
  if new.rsvp_status = 'waitlisted' then
    new.waitlisted_at := case when tg_op = 'UPDATE' and old.rsvp_status = 'waitlisted' then old.waitlisted_at else clock_timestamp() end;
  else
    new.waitlisted_at := null;
  end if;
  return new;
end;
$$;

create trigger event_rsvps_capacity
before insert or update on public.event_rsvps
for each row execute function private.event_rsvp_capacity();

create or replace function private.promote_event_waitlist(_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.events;
  next_member uuid;
begin
  select * into target from public.events where id = _event_id for update;
  if target.id is null or target.status <> 'published' or coalesce(target.ends_at, target.starts_at) <= now() then
    return;
  end if;
  loop
    if target.capacity is not null
       and (select count(*) from public.event_rsvps where event_id = _event_id and rsvp_status = 'going') >= target.capacity then
      exit;
    end if;
    select user_id into next_member from public.event_rsvps
    where event_id = _event_id and rsvp_status = 'waitlisted'
    order by waitlisted_at, user_id limit 1;
    exit when next_member is null;
    update public.event_rsvps set rsvp_status = 'going' where event_id = _event_id and user_id = next_member;
    insert into public.notifications (user_id, kind, title, body, href)
    values (next_member, 'event', 'Tienes una plaza confirmada',
      left('Se liberó una plaza: ' || private.event_label(target) || '. Tu asistencia quedó confirmada.', 1000), '/plataforma?tab=agenda');
    next_member := null;
  end loop;
end;
$$;

create or replace function private.event_rsvp_released()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Skip cascades from a deleted event: there is no event left to promote into.
  if old.rsvp_status = 'going' and (tg_op = 'DELETE' or new.rsvp_status <> 'going')
     and exists (select 1 from public.events where id = old.event_id) then
    perform private.promote_event_waitlist(old.event_id);
  end if;
  return null;
end;
$$;

create trigger event_rsvps_release
after update or delete on public.event_rsvps
for each row execute function private.event_rsvp_released();

-- 2. Event notifications, and promotion when capacity grows.
create or replace function private.event_after_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipients uuid[];
begin
  if new.status = 'published' and (tg_op = 'INSERT' or old.status <> 'published') and coalesce(new.ends_at, new.starts_at) > now() then
    select array_agg(user_id) into recipients from public.memberships where membership_status = 'active';
    perform private.notify_event_users(recipients, 'Nuevo evento en la agenda', private.event_label(new));
  end if;
  if tg_op = 'UPDATE' and old.status = 'published' then
    select array_agg(user_id) into recipients from public.event_rsvps
    where event_id = new.id and rsvp_status in ('going', 'maybe', 'waitlisted');
    if new.status = 'cancelled' then
      perform private.notify_event_users(recipients, 'Evento cancelado', 'Se canceló ' || private.event_label(old) || '.');
    elsif new.status = 'published'
      and (new.starts_at, new.ends_at, new.venue_name, new.venue_address) is distinct from (old.starts_at, old.ends_at, old.venue_name, old.venue_address) then
      perform private.notify_event_users(recipients, 'Cambio en un evento', 'Nueva fecha o lugar: ' || private.event_label(new) || '.');
    end if;
    if new.status = 'published' and (new.capacity is null or new.capacity > coalesce(old.capacity, 0)) then
      perform private.promote_event_waitlist(new.id);
    end if;
  end if;
  return null;
end;
$$;

create trigger events_after_change
after insert or update on public.events
for each row execute function private.event_after_change();

-- 8. Actual attendance, recorded by coordination after the event.
create table public.event_attendance (
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  recorded_by uuid references public.profiles (id) on delete set null default auth.uid(),
  recorded_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
create index event_attendance_user_idx on public.event_attendance (user_id);
create trigger zz_club_audit after insert or update or delete on public.event_attendance
for each row execute function private.capture_club_audit_change('event_id,user_id');
alter table public.event_attendance enable row level security;
revoke all on public.event_attendance from anon, authenticated;
grant select, insert, delete on public.event_attendance to authenticated;
create policy event_attendance_select on public.event_attendance for select to authenticated
using (user_id = (select auth.uid()) or (select private.has_any_role(array['coordinator', 'club_manager', 'admin'])));
create policy event_attendance_insert on public.event_attendance for insert to authenticated
with check ((select private.has_any_role(array['coordinator', 'club_manager', 'admin']))
  and (select private.is_active_user(user_id))
  and exists (select 1 from public.events as event where event.id = event_attendance.event_id
    and event.status = 'published' and event.starts_at <= now()));
create policy event_attendance_delete on public.event_attendance for delete to authenticated
using ((select private.has_any_role(array['coordinator', 'club_manager', 'admin'])));

-- 4/5. Names for confirmed, waitlisted and undecided; counts for the rest.
drop function public.get_event_attendance(uuid[]);
create function public.get_event_attendance(_event_ids uuid[])
returns table (event_id uuid, user_id uuid, display_name text, rsvp_status text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not (select private.is_active_member()) then
    raise exception 'Active membership required.' using errcode = '42501';
  end if;
  if coalesce(cardinality(_event_ids), 0) > 100 then
    raise exception 'Too many event identifiers.' using errcode = '22023';
  end if;
  return query
  select rsvp.event_id, rsvp.user_id, coalesce(nullif(btrim(profile.display_name), ''), 'Miembro del club'), rsvp.rsvp_status
  from public.event_rsvps as rsvp
  join public.events as event on event.id = rsvp.event_id
  left join public.profiles as profile on profile.id = rsvp.user_id
  where rsvp.event_id = any(_event_ids)
    and event.status in ('published', 'cancelled')
    and rsvp.rsvp_status in ('going', 'maybe', 'waitlisted')
  order by rsvp.event_id, rsvp.rsvp_status, rsvp.waitlisted_at nulls first, 3;
end;
$$;

create function public.get_event_attendance_summary(_event_ids uuid[])
returns table (event_id uuid, going integer, maybe integer, waitlisted integer, declined integer, unanswered integer, attended integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  active_members integer;
  coordination boolean := (select private.has_any_role(array['coordinator', 'club_manager', 'admin']));
begin
  if auth.uid() is null or not (select private.is_active_member()) then
    raise exception 'Active membership required.' using errcode = '42501';
  end if;
  if coalesce(cardinality(_event_ids), 0) > 100 then
    raise exception 'Too many event identifiers.' using errcode = '22023';
  end if;
  select count(*)::integer into active_members from public.memberships where membership_status = 'active';
  return query
  select event.id,
    (count(rsvp.user_id) filter (where rsvp.rsvp_status = 'going'))::integer,
    (count(rsvp.user_id) filter (where rsvp.rsvp_status = 'maybe'))::integer,
    (count(rsvp.user_id) filter (where rsvp.rsvp_status = 'waitlisted'))::integer,
    (count(rsvp.user_id) filter (where rsvp.rsvp_status = 'declined'))::integer,
    greatest(active_members - (count(rsvp.user_id) filter (where membership.membership_status = 'active'))::integer, 0),
    case when coordination then (select count(*)::integer from public.event_attendance as record where record.event_id = event.id) end
  from public.events as event
  left join public.event_rsvps as rsvp on rsvp.event_id = event.id
  left join public.memberships as membership on membership.user_id = rsvp.user_id
  where event.id = any(_event_ids)
    and (event.status in ('published', 'cancelled') or coordination)
  group by event.id;
end;
$$;

revoke all on function public.get_event_attendance(uuid[]) from public, anon, authenticated;
grant execute on function public.get_event_attendance(uuid[]) to authenticated;
revoke all on function public.get_event_attendance_summary(uuid[]) from public, anon, authenticated;
grant execute on function public.get_event_attendance_summary(uuid[]) to authenticated;
revoke all on function private.notify_event_users(uuid[], text, text) from public, anon, authenticated;
revoke all on function private.event_label(public.events) from public, anon, authenticated;
revoke all on function private.event_rsvp_capacity() from public, anon, authenticated;
revoke all on function private.promote_event_waitlist(uuid) from public, anon, authenticated;
revoke all on function private.event_rsvp_released() from public, anon, authenticated;
revoke all on function private.event_after_change() from public, anon, authenticated;
