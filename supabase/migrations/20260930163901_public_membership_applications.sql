-- Public applications to join the club. Contact details are disclosed to active members only
-- after the applicant explicitly agrees to that sharing.

create table public.membership_applications (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null,
  phone text not null,
  occupation text,
  motivation text not null,
  referral_source text,
  consented_to_member_sharing boolean not null default false,
  consented_at timestamptz not null default now(),
  status text not null default 'new',
  reviewed_by uuid references public.profiles (id) on delete set null,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint membership_applications_name_length
    check (char_length(btrim(full_name)) between 2 and 120),
  constraint membership_applications_email_format
    check (
      email = lower(btrim(email))
      and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      and char_length(email) <= 254
    ),
  constraint membership_applications_phone_format
    check (
      phone ~ '^[+0-9(). -]{7,40}$'
      and char_length(regexp_replace(phone, '[^0-9]', '', 'g')) >= 7
    ),
  constraint membership_applications_occupation_length
    check (occupation is null or char_length(btrim(occupation)) between 1 and 120),
  constraint membership_applications_motivation_length
    check (char_length(btrim(motivation)) between 20 and 2000),
  constraint membership_applications_referral_length
    check (referral_source is null or char_length(btrim(referral_source)) between 1 and 120),
  constraint membership_applications_consent_required
    check (consented_to_member_sharing),
  constraint membership_applications_status_check
    check (status in ('new', 'contacted', 'invited', 'declined')),
  constraint membership_applications_reviewer_required
    check ((status = 'new') = (reviewed_by is null))
);

create index membership_applications_submitted_idx
  on public.membership_applications (submitted_at desc, id desc);
create index membership_applications_status_submitted_idx
  on public.membership_applications (status, submitted_at desc);
create unique index membership_applications_one_open_request_per_email
  on public.membership_applications (email)
  where status in ('new', 'contacted', 'invited');

alter table public.membership_applications enable row level security;
revoke all on public.membership_applications from public, anon, authenticated, service_role;

-- Public intake is insert-only. The applicant cannot set review fields because they are not granted.
grant insert (full_name, email, phone, occupation, motivation, referral_source, consented_to_member_sharing)
  on public.membership_applications to anon, authenticated;
grant select on public.membership_applications to authenticated;
grant update (status, reviewed_by) on public.membership_applications to authenticated;

create policy membership_applications_submit
on public.membership_applications for insert
to anon, authenticated
with check (
  status = 'new'
  and reviewed_by is null
  and consented_to_member_sharing
);

create policy membership_applications_read_active_members
on public.membership_applications for select
to authenticated
using ((select private.is_active_member()));

create policy membership_applications_review_management
on public.membership_applications for update
to authenticated
using ((select private.has_any_role(array['club_manager', 'admin'])))
with check (
  (select private.has_any_role(array['club_manager', 'admin']))
  and reviewed_by = (select auth.uid())
);

create trigger membership_applications_set_updated_at
before update on public.membership_applications
for each row execute function private.set_updated_at();

create trigger zz_club_audit after insert or update on public.membership_applications
for each row execute function private.capture_club_audit_change('id');
