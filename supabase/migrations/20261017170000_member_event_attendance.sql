-- Active members can see who plans to attend published events. Only names and
-- going/maybe answers are exposed; declined answers stay visible to management
-- through the existing event_rsvps policies.
create function public.get_event_attendance(_event_ids uuid[])
returns table (
  event_id uuid,
  user_id uuid,
  display_name text,
  rsvp_status text
)
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
  select
    rsvp.event_id,
    rsvp.user_id,
    coalesce(nullif(btrim(profile.display_name), ''), 'Miembro del club'),
    rsvp.rsvp_status
  from public.event_rsvps as rsvp
  join public.events as event on event.id = rsvp.event_id
  left join public.profiles as profile on profile.id = rsvp.user_id
  where rsvp.event_id = any(_event_ids)
    and event.status = 'published'
    and rsvp.rsvp_status in ('going', 'maybe')
  order by rsvp.event_id, 3;
end;
$$;

revoke all on function public.get_event_attendance(uuid[]) from public, anon, authenticated;
grant execute on function public.get_event_attendance(uuid[]) to authenticated;
