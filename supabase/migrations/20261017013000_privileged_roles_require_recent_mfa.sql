-- H06/H14: a password alone must not unlock club administration or finances.
-- Every authorization path goes through private.has_any_role(). Privileged
-- roles (admin, club_manager) now count only when the current JWT has
-- aal2 and a second factor was verified in the last 12 hours. Other roles keep
-- their behavior. Privileged users without a recent second factor act with
-- ordinary active-member access until they verify again.

create or replace function private.has_recent_second_factor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with token as (select auth.jwt() as claims)
  select coalesce(token.claims ->> 'aal', 'aal1') = 'aal2'
    and exists (
      select 1 from auth.sessions as session
      where session.id::text = token.claims ->> 'session_id'
        and session.user_id = (select auth.uid())
        and (session.not_after is null or session.not_after > now())
        and session.created_at > now() - interval '24 hours'
    )
    and exists (
      select 1
      from jsonb_array_elements(case when jsonb_typeof(token.claims -> 'amr') = 'array'
        then token.claims -> 'amr' else '[]'::jsonb end) as entry
      where jsonb_typeof(entry) = 'object'
        and entry ->> 'method' in ('totp', 'mfa/totp', 'mfa/phone', 'mfa/webauthn')
        and (entry ->> 'timestamp') ~ '^[0-9]{1,12}$'
        and case when (entry ->> 'timestamp') ~ '^[0-9]{1,12}$' then
          (entry ->> 'timestamp')::bigint between extract(epoch from now())::bigint - 43200
            and extract(epoch from now())::bigint + 60
          else false end
    )
  from token;
$$;

revoke all on function private.has_recent_second_factor() from public, anon, authenticated, service_role;
grant execute on function private.has_recent_second_factor() to authenticated;

create or replace function private.has_any_role(required_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships as membership
    where membership.user_id = (select auth.uid())
      and membership.membership_status = 'active'
      and membership.membership_role = any (required_roles)
      and (
        membership.membership_role not in ('admin', 'club_manager')
        or (select private.has_recent_second_factor())
      )
  );
$$;

comment on function private.has_any_role(text[]) is
  'Role check for RLS and RPC. admin/club_manager require aal2 with a second factor verified in the last 12 hours.';

-- The web server checks the same live session as RLS, including for filesystem
-- diagnostics. Never authorize those reads using signed JWT claims alone.
create or replace function public.has_privileged_session()
returns boolean language sql stable security invoker set search_path = ''
as $$ select private.has_recent_second_factor(); $$;
revoke all on function public.has_privileged_session() from public, anon, authenticated, service_role;
grant execute on function public.has_privileged_session() to authenticated;
