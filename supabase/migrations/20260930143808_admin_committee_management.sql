-- Committee records are now administered by active admins only. Ending a committee
-- preserves its roster and audit history instead of deleting the record.

drop policy if exists committees_select_member on public.committees;
create policy committees_select_member
on public.committees for select
to authenticated
using (
  (select private.is_active_member())
  and (
    is_active = true
    or (select private.has_any_role(array['admin']))
  )
);

drop policy if exists committees_management_insert on public.committees;
create policy committees_management_insert
on public.committees for insert
to authenticated
with check ((select private.has_any_role(array['admin'])));

drop policy if exists committees_management_update on public.committees;
create policy committees_management_update
on public.committees for update
to authenticated
using ((select private.has_any_role(array['admin'])))
with check ((select private.has_any_role(array['admin'])));

-- Committee completion replaces deletion; keep historical committees intact.
drop policy if exists committees_management_delete on public.committees;
revoke delete on public.committees from authenticated;

drop policy if exists committee_members_management_insert on public.committee_members;
create policy committee_members_management_insert
on public.committee_members for insert
to authenticated
with check (
  (select private.has_any_role(array['admin']))
  and exists (
    select 1 from public.committees as committee
    where committee.id = committee_members.committee_id
      and committee.is_active = true
  )
);

drop policy if exists committee_members_management_update on public.committee_members;
create policy committee_members_management_update
on public.committee_members for update
to authenticated
using (
  (select private.has_any_role(array['admin']))
  and exists (
    select 1 from public.committees as committee
    where committee.id = committee_members.committee_id
      and committee.is_active = true
  )
)
with check (
  (select private.has_any_role(array['admin']))
  and exists (
    select 1 from public.committees as committee
    where committee.id = committee_members.committee_id
      and committee.is_active = true
  )
);

drop policy if exists committee_members_management_delete on public.committee_members;
create policy committee_members_management_delete
on public.committee_members for delete
to authenticated
using (
  (select private.has_any_role(array['admin']))
  and exists (
    select 1 from public.committees as committee
    where committee.id = committee_members.committee_id
      and committee.is_active = true
  )
);

create or replace function public.create_committee_with_members(
  _name text,
  _slug text,
  _description text,
  _member_ids uuid[],
  _member_roles text[]
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  committee_id uuid;
  member_count integer := coalesce(cardinality(_member_ids), 0);
begin
  if actor_id is null or not (select private.has_any_role(array['admin'])) then
    raise exception 'Only an active club admin can create committees.' using errcode = '42501';
  end if;

  if _name is null or char_length(btrim(_name)) not between 2 and 140
    or _slug is null or _slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    or (_description is not null and char_length(_description) > 2000) then
    raise exception 'Committee details are invalid.' using errcode = '22023';
  end if;

  if member_count > 50 or member_count <> coalesce(cardinality(_member_roles), 0) then
    raise exception 'Committee member assignments are invalid.' using errcode = '22023';
  end if;

  if (
    select count(distinct member_id)
    from unnest(coalesce(_member_ids, '{}'::uuid[])) as selected(member_id)
  ) <> member_count then
    raise exception 'Committee members must be unique.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(coalesce(_member_roles, '{}'::text[])) as selected(member_role)
    where member_role is null
      or member_role not in ('member', 'chair', 'secretary', 'treasurer')
  ) then
    raise exception 'A committee role is invalid.' using errcode = '22023';
  end if;

  if (
    select count(*)
    from public.memberships as membership
    where membership.user_id = any(coalesce(_member_ids, '{}'::uuid[]))
      and membership.membership_status = 'active'
  ) <> member_count then
    raise exception 'Only active members can join a committee.' using errcode = '22023';
  end if;

  insert into public.committees (name, slug, description, created_by, updated_by)
  values (btrim(_name), _slug, nullif(btrim(_description), ''), actor_id, actor_id)
  returning id into committee_id;

  if member_count > 0 then
    insert into public.committee_members (committee_id, user_id, committee_role)
    select committee_id, selected.member_id, selected.member_role
    from unnest(_member_ids, _member_roles) as selected(member_id, member_role);
  end if;

  return committee_id;
end;
$function$;

revoke all on function public.create_committee_with_members(text, text, text, uuid[], text[])
from public, anon, authenticated;
grant execute on function public.create_committee_with_members(text, text, text, uuid[], text[])
to authenticated;
