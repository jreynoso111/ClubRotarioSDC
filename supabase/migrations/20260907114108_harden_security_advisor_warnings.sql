-- Keep public asset downloads available without allowing anonymous bucket listing.
drop policy if exists club_public_assets_read on storage.objects;

-- Keep the bootstrap operation behind an internal security-definer helper,
-- while exposing only an invoker wrapper through the public API schema.
create or replace function private.claim_initial_admin_internal()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed boolean := false;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  perform pg_advisory_xact_lock(4060);

  if not exists (
    select 1
    from public.memberships as membership
    where membership.membership_role = 'admin'
      and membership.membership_status = 'active'
  ) then
    update public.memberships as membership
    set membership_role = 'admin',
        membership_status = 'active',
        approved_by = (select auth.uid()),
        approved_at = now(),
        joined_at = coalesce(joined_at, now())
    where membership.user_id = (select auth.uid())
      and membership.membership_status = 'pending';
    claimed := found;
  end if;

  return claimed;
end;
$$;

revoke all on function private.claim_initial_admin_internal() from public, anon, authenticated;
grant execute on function private.claim_initial_admin_internal() to authenticated;

create or replace function public.claim_initial_admin()
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select private.claim_initial_admin_internal();
$$;

alter function public.claim_initial_admin() security invoker;
alter function public.submit_proposal(uuid) security invoker;

revoke all on function public.claim_initial_admin() from public, anon, authenticated;
grant execute on function public.claim_initial_admin() to authenticated;
