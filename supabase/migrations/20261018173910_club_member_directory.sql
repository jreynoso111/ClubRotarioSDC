-- Directory membership is distinct from administrative access. Membership rows
-- remain intact because they authorize access and preserve audit/history.
create function public.list_club_member_profiles()
returns table (id uuid, display_name text, bio text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.display_name, p.bio
  from public.profiles p
  join public.memberships m on m.user_id = p.id
  where (select private.is_active_member())
    and m.membership_status = 'active'
    and m.membership_role <> 'admin';
$$;
revoke all on function public.list_club_member_profiles() from public, anon, authenticated, service_role;
grant execute on function public.list_club_member_profiles() to authenticated;
comment on function public.list_club_member_profiles() is
  'Member-directory projection for active signed-in accounts. Excludes system administrators and returns no private membership/auth fields.';
notify pgrst, 'reload schema';
