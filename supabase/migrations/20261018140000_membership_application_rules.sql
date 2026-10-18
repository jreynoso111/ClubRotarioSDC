-- Membership application review rules (2026-10-18):
-- 1. Only club managers and admins review applications, and only through
--    public.review_membership_application (recent second factor, optimistic lock).
-- 2. Declining needs a reason of 5 to 500 characters. Every status change is kept
--    in public.membership_application_history.
-- 3. Ordinary members read applications only through public.list_membership_applications,
--    which hides contact details, motivations, review reasons and the account link.
-- 4. Management keeps internal notes on an application (append-only).
-- 5. Management is notified about new applications and when an invited applicant
--    creates an account.

-- 1. Review columns and constraints.
alter table public.membership_applications
  add column decision_reason text,
  add column invited_at timestamptz,
  add column invited_user_id uuid references auth.users (id) on delete set null;

alter table public.membership_applications
  add constraint membership_applications_decision_reason_length
    check (decision_reason is null or char_length(btrim(decision_reason)) between 5 and 500);

alter table public.membership_applications
  drop constraint if exists membership_applications_reviewer_required;
alter table public.membership_applications
  add constraint membership_applications_reviewer_required
    check (status = 'new' or reviewed_by is not null);

-- Declined applications created before this migration have no reason. NOT VALID keeps
-- those rows usable and enforces the rule on every new or changed row. After a reason is
-- recorded on the legacy rows, run:
--   alter table public.membership_applications validate constraint membership_applications_decline_reason;
alter table public.membership_applications
  add constraint membership_applications_decline_reason
    check (status <> 'declined' or decision_reason is not null) not valid;

-- 2. Writes move to the review function. Ordinary members lose direct reads.
drop policy if exists membership_applications_read_active_members on public.membership_applications;
drop policy if exists membership_applications_review_management on public.membership_applications;
revoke update on public.membership_applications from authenticated;
revoke update (status, reviewed_by) on public.membership_applications from authenticated;

create policy membership_applications_read_management on public.membership_applications
for select to authenticated
using ((select private.has_any_role(array['club_manager', 'admin'])));

-- 3. Internal notes: management only, append-only.
create table public.membership_application_notes (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.membership_applications (id) on delete cascade,
  author_id uuid default auth.uid() references public.profiles (id) on delete set null,
  body text not null,
  created_at timestamptz not null default now(),
  constraint membership_application_notes_body_length
    check (char_length(btrim(body)) between 1 and 2000)
);

create index membership_application_notes_application_idx
  on public.membership_application_notes (application_id, created_at);

alter table public.membership_application_notes enable row level security;
revoke all on public.membership_application_notes from public, anon, authenticated, service_role;
grant select on public.membership_application_notes to authenticated;
grant insert (application_id, body) on public.membership_application_notes to authenticated;

create policy membership_application_notes_read_management on public.membership_application_notes
for select to authenticated
using ((select private.has_any_role(array['club_manager', 'admin'])));

create policy membership_application_notes_insert_management on public.membership_application_notes
for insert to authenticated
with check (
  author_id = (select auth.uid())
  and (select private.has_any_role(array['club_manager', 'admin']))
);

create trigger zz_club_audit after insert or update on public.membership_application_notes
for each row execute function private.capture_club_audit_change('id');

-- 4. Status history: written only by triggers.
create table public.membership_application_history (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.membership_applications (id) on delete cascade,
  from_status text,
  to_status text not null,
  reason text,
  actor_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint membership_application_history_from_status_check
    check (from_status is null or from_status in ('new', 'contacted', 'invited', 'declined')),
  constraint membership_application_history_to_status_check
    check (to_status in ('new', 'contacted', 'invited', 'declined')),
  constraint membership_application_history_reason_length
    check (reason is null or char_length(btrim(reason)) between 5 and 500)
);

create index membership_application_history_application_idx
  on public.membership_application_history (application_id, created_at);

alter table public.membership_application_history enable row level security;
revoke all on public.membership_application_history from public, anon, authenticated, service_role;
grant select on public.membership_application_history to authenticated;

create policy membership_application_history_read_management on public.membership_application_history
for select to authenticated
using ((select private.has_any_role(array['club_manager', 'admin'])));

create trigger zz_club_audit after insert or update on public.membership_application_history
for each row execute function private.capture_club_audit_change('id');

-- 5. Notification helper and triggers.
create or replace function private.notify_membership_managers(_title text, _body text, _href text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, kind, title, body, href)
  select membership.user_id, 'membership', left(_title, 180), left(_body, 1000), _href
  from public.memberships as membership
  where membership.membership_status = 'active'
    and membership.membership_role in ('club_manager', 'admin');
$$;

-- Records the first status (insert) and every later status change.
create or replace function private.membership_application_record_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.membership_application_history (application_id, from_status, to_status, reason, actor_id)
  values (
    new.id,
    case when tg_op = 'UPDATE' then old.status end,
    new.status,
    new.decision_reason,
    (select auth.uid())
  );
  return null;
end;
$$;

create trigger membership_applications_history_insert
after insert on public.membership_applications
for each row execute function private.membership_application_record_history();

create trigger membership_applications_history_status
after update of status on public.membership_applications
for each row when (old.status is distinct from new.status)
execute function private.membership_application_record_history();

create or replace function private.membership_application_notify_new()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.notify_membership_managers(
    'Nueva solicitud de membresía',
    new.full_name || ' quiere unirse al club.',
    '/plataforma?tab=solicitudes'
  );
  return null;
end;
$$;

create trigger membership_applications_notify_new
after insert on public.membership_applications
for each row execute function private.membership_application_notify_new();

-- A sign-up whose email matches an invited applicant links the account and tells
-- management. Any failure here is logged and skipped so the sign-up itself succeeds.
create or replace function private.membership_link_invited_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  account_email text;
  linked record;
begin
  begin
    select lower(btrim(account.email)) into account_email
    from auth.users as account
    where account.id = new.user_id;

    for linked in
      update public.membership_applications as application
      set invited_user_id = new.user_id
      where application.email = account_email
        and application.status = 'invited'
        and application.invited_user_id is null
      returning application.full_name
    loop
      perform private.notify_membership_managers(
        'Solicitante con cuenta creada',
        linked.full_name || ' creó su cuenta. Revisa y aprueba su membresía en Miembros y comités.',
        '/plataforma?tab=organizacion'
      );
    end loop;
  exception when others then
    raise warning 'Membership invitation link skipped: %', sqlerrm;
  end;
  return new;
end;
$$;

create trigger memberships_link_invited_account
after insert on public.memberships
for each row execute function private.membership_link_invited_account();

-- 6. The only write path for application review. updated_at is refreshed by
--    membership_applications_set_updated_at.
create or replace function public.review_membership_application(
  _application_id uuid,
  _status text,
  _reason text,
  _expected_updated_at timestamptz
)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_application public.membership_applications%rowtype;
  reason_text text := nullif(btrim(_reason), '');
  new_updated_at timestamptz;
begin
  if not (select private.has_any_role(array['club_manager', 'admin'])) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if _status is null or _status not in ('new', 'contacted', 'invited', 'declined') then
    raise exception 'Invalid membership application status.' using errcode = '22023';
  end if;
  if _status = 'declined' and (reason_text is null or char_length(reason_text) not between 5 and 500) then
    raise exception 'decline_reason_required' using errcode = '22023';
  end if;
  if reason_text is not null and char_length(reason_text) not between 5 and 500 then
    raise exception 'reason_length' using errcode = '22023';
  end if;

  select * into current_application
  from public.membership_applications as application
  where application.id = _application_id
  for update;
  if not found then
    raise exception 'Membership application not found.' using errcode = 'P0002';
  end if;
  if current_application.updated_at is distinct from _expected_updated_at then
    raise exception 'stale_application' using errcode = 'P0409';
  end if;

  update public.membership_applications as application
  set status = _status,
    reviewed_by = (select auth.uid()),
    decision_reason = reason_text,
    invited_at = case when _status = 'invited' then coalesce(application.invited_at, now()) else application.invited_at end
  where application.id = _application_id
  returning application.updated_at into new_updated_at;

  return new_updated_at;
end;
$$;

-- 7. Read path for the applications list. Members see names and status; management
--    also sees contact details and can search by email.
create or replace function public.list_membership_applications(
  _status text default null,
  _search text default null,
  _limit integer default 20,
  _offset integer default 0
)
returns table (
  id uuid,
  full_name text,
  occupation text,
  status text,
  submitted_at timestamptz,
  updated_at timestamptz,
  email text,
  phone text,
  motivation text,
  referral_source text,
  decision_reason text,
  invited_at timestamptz,
  account_created boolean,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  is_management boolean;
  search_pattern text;
begin
  if not (select private.is_active_member()) then
    raise exception 'An active membership is required.' using errcode = '42501';
  end if;

  is_management := (select private.has_any_role(array['club_manager', 'admin']));
  if nullif(btrim(_search), '') is not null then
    search_pattern := '%' || replace(replace(replace(btrim(_search), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  return query
  select
    application.id,
    application.full_name,
    application.occupation,
    application.status,
    application.submitted_at,
    application.updated_at,
    case when is_management then application.email end,
    case when is_management then application.phone end,
    case when is_management then application.motivation end,
    case when is_management then application.referral_source end,
    case when is_management then application.decision_reason end,
    case when is_management then application.invited_at end,
    is_management and application.invited_user_id is not null,
    count(*) over ()
  from public.membership_applications as application
  where (_status is null or application.status = _status)
    and (
      search_pattern is null
      or application.full_name ilike search_pattern
      or (is_management and application.email ilike search_pattern)
    )
  order by application.submitted_at desc, application.id desc
  limit least(greatest(coalesce(_limit, 20), 1), 50)
  offset greatest(coalesce(_offset, 0), 0);
end;
$$;

-- 8. Privileges.
revoke all on function private.notify_membership_managers(text, text, text) from public, anon, authenticated, service_role;
revoke all on function private.membership_application_record_history() from public, anon, authenticated, service_role;
revoke all on function private.membership_application_notify_new() from public, anon, authenticated, service_role;
revoke all on function private.membership_link_invited_account() from public, anon, authenticated, service_role;

revoke all on function public.review_membership_application(uuid, text, text, timestamptz) from public, anon, service_role;
grant execute on function public.review_membership_application(uuid, text, text, timestamptz) to authenticated;

revoke all on function public.list_membership_applications(text, text, integer, integer) from public, anon, service_role;
grant execute on function public.list_membership_applications(text, text, integer, integer) to authenticated;
