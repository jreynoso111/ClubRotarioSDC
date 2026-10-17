-- QA 2026-10-17: the website enforced these rules, but the tables did not, and
-- /rest/v1 accepts direct writes with a member's own token. These triggers
-- mirror the server actions for direct client writes (current_user =
-- authenticated). Trusted definer functions and the backend operator keep
-- their existing behaviour.

-- Membership access: only an administrator may grant administration, promote
-- someone to club management, or change an administrator's account. Nobody
-- changes their own role or status.
create or replace function private.guard_membership_access()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  if new.user_id is distinct from old.user_id then
    raise exception 'Membership owner cannot be changed.' using errcode = '42501';
  end if;
  if (new.membership_role, new.membership_status) is distinct from (old.membership_role, old.membership_status)
     and old.user_id = (select auth.uid()) then
    raise exception 'Your own access must be changed by another administrator.' using errcode = '42501';
  end if;
  if not (select private.has_any_role(array['admin']))
     and (old.membership_role = 'admin'
          or new.membership_role = 'admin'
          or (new.membership_role = 'club_manager' and old.membership_role <> 'club_manager')) then
    raise exception 'Only an administrator can grant or change administrative access.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger memberships_guard_access
before update on public.memberships
for each row execute function private.guard_membership_access();

-- Profiles: club management cannot rewrite an administrator's profile.
create or replace function private.guard_profile_management()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'authenticated' or old.id = (select auth.uid()) then
    return new;
  end if;
  if new.id is distinct from old.id then
    raise exception 'Profile owner cannot be changed.' using errcode = '42501';
  end if;
  if not (select private.has_any_role(array['admin']))
     and exists (select 1 from public.memberships m where m.user_id = old.id and m.membership_role = 'admin') then
    raise exception 'Only an administrator can change an administrator profile.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profiles_guard_management
before update on public.profiles
for each row execute function private.guard_profile_management();

-- Proposals: an author without coordination rights may edit, submit or correct
-- their own proposal, but may not open a ballot or record a review.
create or replace function private.guard_proposal_author()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'authenticated'
     or (select private.has_any_role(array['coordinator', 'club_manager', 'admin'])) then
    return new;
  end if;
  if not (select private.is_active_member()) then
    raise exception 'An active membership is required.' using errcode = '42501';
  end if;
  if new.status not in ('draft', 'submitted')
     or (new.voting_open and not old.voting_open)
     or (new.reviewed_by is not null and new.reviewed_by is distinct from old.reviewed_by)
     or (new.reviewed_at is not null and new.reviewed_at is distinct from old.reviewed_at)
     or new.review_notes is distinct from old.review_notes then
    raise exception 'Only club coordination can review a proposal or open its ballot.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger proposals_guard_author
before update on public.proposals
for each row execute function private.guard_proposal_author();

-- Tasks: an assignee without coordination rights only reports progress.
create or replace function private.guard_task_assignee()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'authenticated'
     or (select private.has_any_role(array['coordinator', 'club_manager', 'admin'])) then
    return new;
  end if;
  if not (select private.is_active_member()) then
    raise exception 'An active membership is required.' using errcode = '42501';
  end if;
  if (new.title, new.description, new.priority, new.due_at, new.assignee_id, new.activity_id, new.proposal_id, new.created_by, new.created_at)
     is distinct from
     (old.title, old.description, old.priority, old.due_at, old.assignee_id, old.activity_id, old.proposal_id, old.created_by, old.created_at) then
    raise exception 'Assignees can only update the status of their task.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger tasks_guard_assignee
before update on public.tasks
for each row execute function private.guard_task_assignee();

revoke all on function private.guard_membership_access() from public, anon, authenticated;
revoke all on function private.guard_profile_management() from public, anon, authenticated;
revoke all on function private.guard_proposal_author() from public, anon, authenticated;
revoke all on function private.guard_task_assignee() from public, anon, authenticated;
