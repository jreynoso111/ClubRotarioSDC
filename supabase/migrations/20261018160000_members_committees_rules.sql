-- Members and committees rules (2026-10-18):
-- 1. Membership access changes go only through public.update_member_access: recent second
--    factor, peer rules for club management, optimistic lock, reasons and history.
--    Signed-in users lose direct UPDATE on public.memberships.
-- 2. The last active administrator cannot be demoted or suspended (P0410).
-- 3. Every role or status change is kept in public.membership_access_history.
-- 4. Members are told about approval, suspension, reactivation and role changes.
--    Management is told when a suspended member still holds committee or organisation seats.
-- 5. Management is told when a sign-up confirms its email: a pending approval, or an invited
--    applicant who created the account.
-- 6. Pending members are listed and rejected through public functions. A rejection keeps a
--    record and declines the matching application before the sign-up is deleted.
-- 7. Members' own notes are private; management reads them through public.get_membership_notes.
-- 8. A committee has at most one chair.
-- 9. Club management manages committees like administrators, including reopening them.
-- 10. Only an administrator can change a club management account, directly or by trigger.

-- 8. Committees: keep one chair per committee. Extra chairs keep the earliest joined_at
--    (tie-break by user_id) and become members.
with ranked_chairs as (
  select committee_id, user_id,
    row_number() over (partition by committee_id order by joined_at, user_id) as chair_rank
  from public.committee_members
  where committee_role = 'chair'
)
update public.committee_members as member
set committee_role = 'member'
from ranked_chairs
where member.committee_id = ranked_chairs.committee_id
  and member.user_id = ranked_chairs.user_id
  and ranked_chairs.chair_rank > 1;

create unique index committee_members_one_chair_idx
on public.committee_members (committee_id)
where committee_role = 'chair';

-- 9. Club management acts like administration on committees, including reopening them.
drop policy if exists committees_select_member on public.committees;
create policy committees_select_member
on public.committees for select
to authenticated
using (
  (select private.is_active_member())
  and (
    is_active = true
    or (select private.has_any_role(array['club_manager', 'admin']))
  )
);

drop policy if exists committees_management_insert on public.committees;
create policy committees_management_insert
on public.committees for insert
to authenticated
with check ((select private.has_any_role(array['club_manager', 'admin'])));

drop policy if exists committees_management_update on public.committees;
create policy committees_management_update
on public.committees for update
to authenticated
using ((select private.has_any_role(array['club_manager', 'admin'])))
with check ((select private.has_any_role(array['club_manager', 'admin'])));

drop policy if exists committee_members_management_insert on public.committee_members;
create policy committee_members_management_insert
on public.committee_members for insert
to authenticated
with check (
  (select private.has_any_role(array['club_manager', 'admin']))
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
  (select private.has_any_role(array['club_manager', 'admin']))
  and exists (
    select 1 from public.committees as committee
    where committee.id = committee_members.committee_id
      and committee.is_active = true
  )
)
with check (
  (select private.has_any_role(array['club_manager', 'admin']))
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
  (select private.has_any_role(array['club_manager', 'admin']))
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
  if actor_id is null or not (select private.has_any_role(array['club_manager', 'admin'])) then
    raise exception 'Only an active club manager or administrator can create committees.' using errcode = '42501';
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
    from unnest(coalesce(_member_roles, '{}'::text[])) as selected(member_role)
    where member_role = 'chair'
  ) > 1 then
    raise exception 'A committee can have only one chair.' using errcode = '22023';
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

-- 10. Peer rule, also for direct writes: only an administrator may change a club
--     management row, and only an administrator may grant administration.
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
     and (old.membership_role in ('admin', 'club_manager')
          or new.membership_role = 'admin'
          or (new.membership_role = 'club_manager' and old.membership_role <> 'club_manager')) then
    raise exception 'Only an administrator can grant or change administrative access.' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- 2. Last administrator. The advisory lock serializes concurrent demotions so two
--    administrators cannot remove each other at the same time.
create or replace function private.current_rotary_year()
returns integer
language sql
stable
set search_path = ''
as $$
  select extract(year from now() at time zone 'America/Santo_Domingo')::integer
    - case when extract(month from now() at time zone 'America/Santo_Domingo') < 7 then 1 else 0 end;
$$;

create or replace function private.guard_last_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  leaves_admin boolean;
begin
  if old.membership_role = 'admin' and old.membership_status = 'active' then
    perform pg_advisory_xact_lock(hashtext('club_last_admin'));
    if tg_op = 'DELETE' then
      leaves_admin := true;
    else
      leaves_admin := new.membership_role <> 'admin' or new.membership_status <> 'active';
    end if;
    if leaves_admin and not exists (
      select 1
      from public.memberships as other
      where other.user_id <> old.user_id
        and other.membership_role = 'admin'
        and other.membership_status = 'active'
    ) then
      raise exception 'last_admin' using errcode = 'P0410';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger memberships_guard_last_admin
before update or delete on public.memberships
for each row execute function private.guard_last_admin();

-- 3. Access history. Written only by the trigger; the reason travels in a transaction-local setting.
create table public.membership_access_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  from_role text not null,
  to_role text not null,
  from_status text not null,
  to_status text not null,
  reason text,
  actor_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint membership_access_history_roles_check
    check (from_role in ('member', 'coordinator', 'editor', 'club_manager', 'admin')
      and to_role in ('member', 'coordinator', 'editor', 'club_manager', 'admin')),
  constraint membership_access_history_status_check
    check (from_status in ('pending', 'active', 'suspended')
      and to_status in ('pending', 'active', 'suspended')),
  constraint membership_access_history_reason_length
    check (reason is null or char_length(btrim(reason)) between 5 and 500)
);

create index membership_access_history_user_created_idx
  on public.membership_access_history (user_id, created_at);
create index membership_access_history_actor_idx
  on public.membership_access_history (actor_id);

alter table public.membership_access_history enable row level security;
revoke all on public.membership_access_history from public, anon, authenticated, service_role;
grant select on public.membership_access_history to authenticated;

create policy membership_access_history_read_management
on public.membership_access_history for select
to authenticated
using ((select private.has_any_role(array['club_manager', 'admin'])));

create trigger zz_club_audit after insert or update or delete on public.membership_access_history
for each row execute function private.capture_club_audit_change('id');

create or replace function private.membership_record_access_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.membership_access_history (
    user_id, from_role, to_role, from_status, to_status, reason, actor_id
  )
  values (
    new.user_id,
    old.membership_role,
    new.membership_role,
    old.membership_status,
    new.membership_status,
    nullif(btrim(current_setting('club.access_reason', true)), ''),
    (select auth.uid())
  );
  return null;
end;
$$;

create trigger memberships_access_history
after update of membership_role, membership_status on public.memberships
for each row
when (old.membership_role is distinct from new.membership_role
  or old.membership_status is distinct from new.membership_status)
execute function private.membership_record_access_change();

-- 4 and 4b. Member notices and the suspended-with-seats notice for management.
create or replace function private.membership_notify_access_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  reason_text text := nullif(btrim(current_setting('club.access_reason', true)), '');
  status_title text;
  status_body text;
  role_sentence text;
  member_name text;
  committee_seats integer := 0;
  position_seats integer := 0;
begin
  if old.membership_status is distinct from new.membership_status then
    if old.membership_status = 'pending' and new.membership_status = 'active' then
      status_title := 'Tu membresía fue aprobada';
      status_body := 'Ya eres miembro activo del club. ¡Bienvenido!';
    elsif old.membership_status = 'suspended' and new.membership_status = 'active' then
      status_title := 'Tu membresía fue reactivada';
      status_body := 'Tu acceso a la plataforma del club vuelve a estar activo.';
    elsif new.membership_status = 'suspended' then
      status_title := 'Tu membresía fue suspendida';
      status_body := 'Tu acceso a la plataforma queda restringido.'
        || coalesce(' Motivo: ' || reason_text, '');
    end if;
  end if;

  if old.membership_role is distinct from new.membership_role and new.membership_status = 'active' then
    role_sentence := 'Ahora tu rol es ' || case new.membership_role
      when 'coordinator' then 'Coordinación'
      when 'editor' then 'Editor'
      when 'club_manager' then 'Gestión del club'
      when 'admin' then 'Administración'
      else 'Miembro'
    end || '.';
  end if;

  if status_title is not null then
    insert into public.notifications (user_id, kind, title, body, href)
    values (new.user_id, 'membership', status_title,
      status_body || coalesce(' ' || role_sentence, ''), '/plataforma');
  elsif role_sentence is not null then
    insert into public.notifications (user_id, kind, title, body, href)
    values (new.user_id, 'membership', 'Tu rol en el club cambió', role_sentence, '/plataforma');
  end if;

  -- Seats are reported, never removed automatically.
  if new.membership_status = 'suspended' and old.membership_status is distinct from 'suspended' then
    select count(*)::integer into committee_seats
    from public.committee_members as seat
    join public.committees as committee on committee.id = seat.committee_id
    where seat.user_id = new.user_id
      and committee.is_active = true;

    select count(*)::integer into position_seats
    from public.club_leadership_positions as seat_position
    join public.club_leadership_terms as leadership_term on leadership_term.id = seat_position.term_id
    where seat_position.member_id = new.user_id
      and seat_position.is_active = true
      and leadership_term.start_year = private.current_rotary_year();

    if committee_seats + position_seats > 0 then
      select coalesce(nullif(btrim(profile.display_name), ''), 'Miembro sin nombre')
        into member_name
      from public.profiles as profile
      where profile.id = new.user_id;

      perform private.notify_membership_managers(
        'Miembro suspendido con cargos',
        coalesce(member_name, 'Miembro sin nombre') || ' fue suspendido y sigue en '
          || committee_seats || ' comité(s) y ' || position_seats || ' cargo(s). Decide si reasignarlos.',
        '/plataforma?tab=organizacion'
      );
    end if;
  end if;

  return null;
end;
$$;

create trigger memberships_notify_access_change
after update of membership_role, membership_status on public.memberships
for each row
when (old.membership_role is distinct from new.membership_role
  or old.membership_status is distinct from new.membership_status)
execute function private.membership_notify_access_change();

-- 6. Sign-up alerts after email confirmation. The old link ran at membership insert,
--    before the address was confirmed. It is replaced here. The trigger name sorts after
--    on_auth_user_created, so the membership row already exists when this one runs.
drop trigger if exists memberships_link_invited_account on public.memberships;
drop function if exists private.membership_link_invited_account();

create or replace function private.membership_signup_notice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  account_email text;
  applicant_name text;
  linked record;
  linked_count integer := 0;
begin
  -- A failure here must never block the sign-up itself.
  begin
    if new.email_confirmed_at is null then
      return null;
    end if;
    if tg_op = 'UPDATE' and old.email_confirmed_at is not null then
      return null;
    end if;

    account_email := lower(btrim(new.email::text));
    for linked in
      update public.membership_applications as application
      set invited_user_id = new.id
      where application.email = account_email
        and application.status = 'invited'
        and application.invited_user_id is null
      returning application.full_name
    loop
      linked_count := linked_count + 1;
      perform private.notify_membership_managers(
        'Solicitante con cuenta creada',
        linked.full_name || ' creó su cuenta. Revisa y aprueba su membresía en Miembros y comités.',
        '/plataforma?tab=organizacion'
      );
    end loop;

    if linked_count = 0 and exists (
      select 1
      from public.memberships as membership
      where membership.user_id = new.id
        and membership.membership_status = 'pending'
    ) then
      select profile.display_name into applicant_name
      from public.profiles as profile
      where profile.id = new.id;
      applicant_name := coalesce(nullif(btrim(applicant_name), ''), btrim(new.email::text), 'Nueva persona');

      perform private.notify_membership_managers(
        'Nuevo registro pendiente de aprobación',
        applicant_name || ' creó su cuenta y espera aprobación.',
        '/plataforma?tab=organizacion'
      );
    end if;
  exception when others then
    raise warning 'Membership sign-up notice skipped: %', sqlerrm;
  end;
  return null;
end;
$$;

create trigger zz_membership_signup_notice
after insert or update of email_confirmed_at on auth.users
for each row execute function private.membership_signup_notice();

-- 7. Pending members: list and reject.
create table public.membership_rejections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  display_name text,
  email text,
  reason text not null,
  application_id uuid references public.membership_applications (id) on delete set null,
  rejected_by uuid references public.profiles (id) on delete set null,
  rejected_at timestamptz not null default now(),
  constraint membership_rejections_reason_length
    check (char_length(btrim(reason)) between 5 and 500)
);

create index membership_rejections_rejected_idx on public.membership_rejections (rejected_at desc, id);
create index membership_rejections_application_idx on public.membership_rejections (application_id);
create index membership_rejections_rejected_by_idx on public.membership_rejections (rejected_by);

alter table public.membership_rejections enable row level security;
revoke all on public.membership_rejections from public, anon, authenticated, service_role;
grant select on public.membership_rejections to authenticated;

create policy membership_rejections_read_management
on public.membership_rejections for select
to authenticated
using ((select private.has_any_role(array['club_manager', 'admin'])));

create trigger zz_club_audit after insert or update or delete on public.membership_rejections
for each row execute function private.capture_club_audit_change('id');

create or replace function private.membership_application_for_user(_user_id uuid, _email text)
returns uuid
language sql
stable
set search_path = ''
as $$
  select application.id
  from public.membership_applications as application
  where application.invited_user_id = _user_id
     or application.email = lower(btrim(_email))
  order by case when application.invited_user_id = _user_id then 0 else 1 end,
    application.submitted_at desc,
    application.id desc
  limit 1;
$$;

create or replace function public.list_pending_members()
returns table (
  user_id uuid,
  display_name text,
  email text,
  email_confirmed boolean,
  registered_at timestamptz,
  application_id uuid,
  application_status text,
  application_full_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select private.has_any_role(array['club_manager', 'admin'])) then
    raise exception 'Only an active club manager or administrator can review pending members.' using errcode = '42501';
  end if;

  return query
  select
    membership.user_id,
    profile.display_name,
    account.email::text,
    account.email_confirmed_at is not null,
    account.created_at,
    application.id,
    application.status,
    application.full_name
  from public.memberships as membership
  join public.profiles as profile on profile.id = membership.user_id
  join auth.users as account on account.id = membership.user_id
  left join public.membership_applications as application
    on application.id = private.membership_application_for_user(membership.user_id, account.email::text)
  where membership.membership_status = 'pending'
  order by account.created_at desc, membership.user_id;
end;
$$;

create or replace function public.reject_pending_member(_user_id uuid, _reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_status text;
  target_role text;
  target_name text;
  target_email text;
  reason_text text := btrim(coalesce(_reason, ''));
  matched_application_id uuid;
begin
  if not (select private.has_any_role(array['club_manager', 'admin'])) then
    raise exception 'Only an active club manager or administrator can reject members.' using errcode = '42501';
  end if;

  select membership.membership_status, membership.membership_role
    into target_status, target_role
  from public.memberships as membership
  where membership.user_id = _user_id
  for update;
  if target_status is distinct from 'pending' then
    raise exception 'not_pending' using errcode = '22023';
  end if;
  if target_role in ('admin', 'club_manager')
     and not (select private.has_any_role(array['admin'])) then
    raise exception 'Only an administrator can reject an administrative account.' using errcode = '42501';
  end if;

  if reason_text = '' then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  if char_length(reason_text) not between 5 and 500 then
    raise exception 'reason_length' using errcode = '22023';
  end if;

  select profile.display_name, account.email::text
    into target_name, target_email
  from public.profiles as profile
  join auth.users as account on account.id = profile.id
  where profile.id = _user_id;

  matched_application_id := private.membership_application_for_user(_user_id, target_email);

  insert into public.membership_rejections (user_id, display_name, email, reason, application_id, rejected_by)
  values (_user_id, target_name, target_email, reason_text, matched_application_id, actor_id);

  if matched_application_id is not null then
    update public.membership_applications as application
    set status = 'declined',
        decision_reason = reason_text,
        reviewed_by = actor_id,
        invited_user_id = null
    where application.id = matched_application_id;
  end if;

  -- Deleting the Auth account cascades to the profile and membership. Any other
  -- activity that blocks the deletion stops the whole rejection with a clear message.
  begin
    delete from auth.users where id = _user_id;
  exception when foreign_key_violation then
    raise exception 'member_has_activity' using errcode = '22023';
  end;
end;
$$;

-- 9. Members' own notes are private. Management reads them through this function.
create or replace function public.get_membership_notes(_user_ids uuid[])
returns table (user_id uuid, notes text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select private.has_any_role(array['club_manager', 'admin'])) then
    raise exception 'Only an active club manager or administrator can read member notes.' using errcode = '42501';
  end if;

  return query
  select membership.user_id, membership.notes
  from public.memberships as membership
  where membership.user_id = any (coalesce(_user_ids, '{}'::uuid[]));
end;
$$;

-- 1. The only write path for membership access. It mirrors app/plataforma/members-actions.ts
--    for the first activation dates, and records the reason for the history and notices.
create or replace function public.update_member_access(
  _user_id uuid,
  _role text,
  _status text,
  _notes text,
  _reason text,
  _expected_updated_at timestamptz
)
returns table (
  updated_at timestamptz,
  email text,
  display_name text,
  previous_role text,
  previous_status text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role text;
  current_row public.memberships%rowtype;
  notes_text text := nullif(btrim(_notes), '');
  reason_text text := nullif(btrim(_reason), '');
  role_changed boolean;
  status_changed boolean;
  saved_at timestamptz;
begin
  if not (select private.has_any_role(array['club_manager', 'admin'])) then
    raise exception 'Only an active club manager or administrator can change member access.' using errcode = '42501';
  end if;

  select membership.membership_role into actor_role
  from public.memberships as membership
  where membership.user_id = actor_id;

  if _user_id is null or _user_id = actor_id then
    raise exception 'Your own access must be changed by another administrator.' using errcode = '42501';
  end if;
  if _role is null or _role not in ('member', 'coordinator', 'editor', 'club_manager', 'admin')
     or _status is null or _status not in ('pending', 'active', 'suspended') then
    raise exception 'Invalid member access.' using errcode = '22023';
  end if;
  if notes_text is not null and char_length(notes_text) > 4000 then
    raise exception 'Member notes are too long.' using errcode = '22023';
  end if;

  select * into current_row
  from public.memberships as membership
  where membership.user_id = _user_id
  for update;
  if not found then
    raise exception 'Membership not found.' using errcode = 'P0002';
  end if;

  if actor_role <> 'admin'
     and (current_row.membership_role in ('admin', 'club_manager') or _role in ('admin', 'club_manager')) then
    raise exception 'Only an administrator can grant administrative access or change an administrator or club management account.'
      using errcode = '42501';
  end if;

  if current_row.updated_at is distinct from _expected_updated_at then
    raise exception 'stale_member' using errcode = 'P0409';
  end if;

  role_changed := _role is distinct from current_row.membership_role;
  status_changed := _status is distinct from current_row.membership_status;
  if (role_changed or (status_changed and _status = 'suspended'))
     and (reason_text is null or char_length(reason_text) not between 5 and 500) then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  if reason_text is not null and char_length(reason_text) not between 5 and 500 then
    raise exception 'reason_length' using errcode = '22023';
  end if;

  perform set_config('club.access_reason', coalesce(reason_text, ''), true);

  update public.memberships as membership
  set membership_role = _role,
      membership_status = _status,
      notes = notes_text,
      joined_at = case when _status = 'active' and current_row.joined_at is null
        then now() else current_row.joined_at end,
      approved_at = case when _status = 'active' and current_row.approved_at is null
        then now() else current_row.approved_at end,
      approved_by = case when _status = 'active' and current_row.approved_by is null
        then actor_id else current_row.approved_by end
  where membership.user_id = _user_id
  returning membership.updated_at into saved_at;

  perform set_config('club.access_reason', '', true);

  return query
  select saved_at,
    account.email::text,
    profile.display_name,
    current_row.membership_role,
    current_row.membership_status
  from auth.users as account
  left join public.profiles as profile on profile.id = account.id
  where account.id = _user_id;
end;
$$;

-- 1 and 2 (grants): access changes go only through the function; members lose direct UPDATE.
-- The organisation RPC writes memberships on the caller's behalf, so it runs as definer after
-- its own administrator check, as the access RPC does.
alter function public.save_club_leadership_position(uuid, uuid, text, text, uuid, uuid, integer, boolean, text, boolean, timestamptz)
  security definer;

drop policy if exists memberships_update_management on public.memberships;
revoke select, update on public.memberships from authenticated;
grant select (user_id, membership_role, membership_status, approved_by, approved_at, joined_at, created_at, updated_at)
  on public.memberships to authenticated;

-- Privileges for new functions.
revoke all on function private.current_rotary_year() from public, anon, authenticated, service_role;
revoke all on function private.guard_last_admin() from public, anon, authenticated, service_role;
revoke all on function private.membership_record_access_change() from public, anon, authenticated, service_role;
revoke all on function private.membership_notify_access_change() from public, anon, authenticated, service_role;
revoke all on function private.membership_signup_notice() from public, anon, authenticated, service_role;
revoke all on function private.membership_application_for_user(uuid, text) from public, anon, authenticated, service_role;

revoke all on function public.update_member_access(uuid, text, text, text, text, timestamptz) from public, anon, service_role;
grant execute on function public.update_member_access(uuid, text, text, text, text, timestamptz) to authenticated;

revoke all on function public.list_pending_members() from public, anon, service_role;
grant execute on function public.list_pending_members() to authenticated;

revoke all on function public.reject_pending_member(uuid, text) from public, anon, service_role;
grant execute on function public.reject_pending_member(uuid, text) to authenticated;

revoke all on function public.get_membership_notes(uuid[]) from public, anon, service_role;
grant execute on function public.get_membership_notes(uuid[]) to authenticated;
