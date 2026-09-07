-- Club Rotario Santo Domingo Colonial
-- Initial application backend: identity, public content, member operations,
-- proposals, activities, and controlled media storage.

create schema if not exists private;

revoke all on schema private from public;
grant usage on schema private to anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  bio text,
  avatar_path text,
  locale text not null default 'es-DO',
  timezone text not null default 'America/Santo_Domingo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_length
    check (display_name is null or char_length(btrim(display_name)) <= 120),
  constraint profiles_bio_length
    check (bio is null or char_length(bio) <= 4000),
  constraint profiles_locale_format
    check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$')
);

create table public.memberships (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  membership_role text not null default 'member',
  membership_status text not null default 'pending',
  notes text,
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint memberships_role_check
    check (membership_role in ('member', 'coordinator', 'editor', 'club_manager', 'admin')),
  constraint memberships_status_check
    check (membership_status in ('pending', 'active', 'suspended')),
  constraint memberships_notes_length
    check (notes is null or char_length(notes) <= 4000)
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null unique,
  summary text,
  description text,
  kind text not null default 'encuentro',
  tone text not null default 'lime',
  starts_at timestamptz not null,
  ends_at timestamptz,
  venue_name text,
  venue_address text,
  location_url text,
  capacity integer,
  cover_image_path text,
  status text not null default 'draft',
  is_public boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_title_length
    check (char_length(btrim(title)) between 3 and 160),
  constraint events_slug_format
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint events_summary_length
    check (summary is null or char_length(summary) <= 600),
  constraint events_kind_check
    check (kind in ('encuentro', 'servicio', 'plataforma', 'reunion', 'otro')),
  constraint events_tone_check
    check (tone in ('lime', 'sun', 'coral', 'teal')),
  constraint events_ends_after_start
    check (ends_at is null or ends_at > starts_at),
  constraint events_location_url_check
    check (location_url is null or location_url ~* '^https?://'),
  constraint events_capacity_check
    check (capacity is null or capacity >= 0),
  constraint events_status_check
    check (status in ('draft', 'published', 'cancelled', 'archived'))
);

create table public.stories (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null unique,
  excerpt text,
  content text not null default '',
  story_type text not null default 'cronica',
  status text not null default 'draft',
  is_public boolean not null default false,
  published_at timestamptz,
  cover_image_path text,
  author_id uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles (id) on delete set null,
  search_vector tsvector generated always as (
    to_tsvector(
      'spanish'::regconfig,
      coalesce(title, '') || ' ' || coalesce(excerpt, '') || ' ' || coalesce(content, '')
    )
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stories_title_length
    check (char_length(btrim(title)) between 3 and 180),
  constraint stories_slug_format
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint stories_excerpt_length
    check (excerpt is null or char_length(excerpt) <= 1000),
  constraint stories_story_type_check
    check (story_type in ('cronica', 'voces', 'archivo', 'noticia', 'otro')),
  constraint stories_status_check
    check (status in ('draft', 'published', 'archived'))
);

create table public.site_settings (
  id text primary key default 'club',
  site_name text not null,
  tagline text,
  public_email text,
  timezone text not null default 'America/Santo_Domingo',
  logo_path text,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint site_settings_singleton check (id = 'club'),
  constraint site_settings_email_check
    check (public_email is null or public_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);

create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  summary text not null,
  details text not null default '',
  status text not null default 'draft',
  submitted_at timestamptz,
  reviewed_at timestamptz,
  review_notes text,
  created_by uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  reviewed_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint proposals_title_length
    check (char_length(btrim(title)) between 3 and 180),
  constraint proposals_summary_length
    check (char_length(btrim(summary)) between 10 and 1200),
  constraint proposals_status_check
    check (status in ('draft', 'submitted', 'in_review', 'approved', 'rejected', 'archived')),
  constraint proposals_review_notes_length
    check (review_notes is null or char_length(review_notes) <= 4000)
);

create table public.committees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  is_active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint committees_name_length
    check (char_length(btrim(name)) between 2 and 140),
  constraint committees_slug_format
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint committees_description_length
    check (description is null or char_length(description) <= 2000)
);

create table public.committee_members (
  committee_id uuid not null references public.committees (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  committee_role text not null default 'member',
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (committee_id, user_id),
  constraint committee_members_role_check
    check (committee_role in ('member', 'chair', 'secretary', 'treasurer'))
);

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null unique,
  description text,
  activity_status text not null default 'planned',
  starts_at timestamptz,
  ends_at timestamptz,
  location text,
  lead_id uuid references public.profiles (id) on delete set null,
  proposal_id uuid references public.proposals (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint activities_title_length
    check (char_length(btrim(title)) between 3 and 180),
  constraint activities_slug_format
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint activities_status_check
    check (activity_status in ('planned', 'active', 'completed', 'cancelled')),
  constraint activities_ends_after_start
    check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid references public.activities (id) on delete cascade,
  proposal_id uuid references public.proposals (id) on delete cascade,
  title text not null,
  description text,
  task_status text not null default 'todo',
  priority text not null default 'normal',
  due_at timestamptz,
  assignee_id uuid references public.profiles (id) on delete set null,
  completed_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_parent_check
    check (activity_id is not null or proposal_id is not null),
  constraint tasks_title_length
    check (char_length(btrim(title)) between 2 and 180),
  constraint tasks_status_check
    check (task_status in ('todo', 'in_progress', 'blocked', 'done', 'cancelled')),
  constraint tasks_priority_check
    check (priority in ('low', 'normal', 'high', 'urgent')),
  constraint tasks_description_length
    check (description is null or char_length(description) <= 4000)
);

create table public.event_rsvps (
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  rsvp_status text not null default 'going',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (event_id, user_id),
  constraint event_rsvps_status_check
    check (rsvp_status in ('going', 'maybe', 'declined'))
);

create table public.access_requests (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null,
  message text,
  source text not null default 'homepage',
  request_status text not null default 'pending',
  handled_by uuid references public.profiles (id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint access_requests_name_length
    check (char_length(btrim(full_name)) between 2 and 160),
  constraint access_requests_email_check
    check (email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint access_requests_message_length
    check (message is null or char_length(message) <= 3000),
  constraint access_requests_source_check
    check (source in ('homepage', 'referral', 'other')),
  constraint access_requests_status_check
    check (request_status in ('pending', 'contacted', 'approved', 'rejected'))
);

create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null,
  path text not null,
  alt_text text,
  asset_kind text not null default 'image',
  uploaded_by uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  constraint media_assets_bucket_check
    check (bucket_id in ('club-public', 'club-media')),
  constraint media_assets_path_check
    check (path <> '' and left(path, 1) <> '/'),
  constraint media_assets_alt_text_length
    check (alt_text is null or char_length(alt_text) <= 300),
  constraint media_assets_kind_check
    check (asset_kind in ('image', 'document', 'video', 'other')),
  constraint media_assets_bucket_path_unique unique (bucket_id, path)
);

create index memberships_active_user_role_idx
  on public.memberships (user_id, membership_role)
  where membership_status = 'active';
create index memberships_approved_by_idx on public.memberships (approved_by);

create index events_created_by_idx on public.events (created_by);
create index events_updated_by_idx on public.events (updated_by);
create index events_public_starts_idx
  on public.events (starts_at, id)
  where status = 'published' and is_public = true;

create index stories_author_id_idx on public.stories (author_id);
create index stories_created_by_idx on public.stories (created_by);
create index stories_updated_by_idx on public.stories (updated_by);
create index stories_public_published_idx
  on public.stories (published_at desc, id)
  where status = 'published' and is_public = true;
create index stories_search_idx on public.stories using gin (search_vector);

create index site_settings_updated_by_idx on public.site_settings (updated_by);

create index proposals_created_by_idx on public.proposals (created_by);
create index proposals_reviewed_by_idx on public.proposals (reviewed_by);
create index proposals_status_created_idx on public.proposals (status, created_at desc, id);

create index committees_created_by_idx on public.committees (created_by);
create index committees_updated_by_idx on public.committees (updated_by);

create index committee_members_user_id_idx on public.committee_members (user_id);

create index activities_lead_id_idx on public.activities (lead_id);
create index activities_proposal_id_idx on public.activities (proposal_id);
create index activities_created_by_idx on public.activities (created_by);
create index activities_updated_by_idx on public.activities (updated_by);

create index tasks_activity_id_idx on public.tasks (activity_id);
create index tasks_proposal_id_idx on public.tasks (proposal_id);
create index tasks_assignee_id_idx on public.tasks (assignee_id);
create index tasks_created_by_idx on public.tasks (created_by);
create index tasks_updated_by_idx on public.tasks (updated_by);
create index tasks_open_due_idx
  on public.tasks (due_at, id)
  where task_status in ('todo', 'in_progress', 'blocked');

create index event_rsvps_user_id_idx on public.event_rsvps (user_id);
create index access_requests_handled_by_idx on public.access_requests (handled_by);
create index access_requests_pending_idx
  on public.access_requests (created_at desc, id)
  where request_status = 'pending';
create index media_assets_uploaded_by_idx on public.media_assets (uploaded_by);

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
  );
$$;

create or replace function private.is_active_member()
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
  );
$$;

create or replace function private.can_rsvp(_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.is_active_member())
    and exists (
      select 1
      from public.events as event
      where event.id = _event_id
        and event.status = 'published'
    );
$$;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function private.set_audit_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.created_by is null then
    new.created_by := (select auth.uid());
  end if;
  new.updated_by := (select auth.uid());
  return new;
end;
$$;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    nullif(
      btrim(coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'full_name')),
      ''
    )
  )
  on conflict (id) do nothing;

  insert into public.memberships (user_id, membership_role, membership_status)
  values (new.id, 'member', 'pending')
  on conflict (user_id) do nothing;

  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

create trigger memberships_set_updated_at
before update on public.memberships
for each row execute function private.set_updated_at();

create trigger events_set_updated_at
before update on public.events
for each row execute function private.set_updated_at();

create trigger events_set_audit_fields
before insert or update on public.events
for each row execute function private.set_audit_fields();

create trigger stories_set_updated_at
before update on public.stories
for each row execute function private.set_updated_at();

create trigger stories_set_audit_fields
before insert or update on public.stories
for each row execute function private.set_audit_fields();

create trigger site_settings_set_updated_at
before update on public.site_settings
for each row execute function private.set_updated_at();

create trigger proposals_set_updated_at
before update on public.proposals
for each row execute function private.set_updated_at();

create trigger committees_set_updated_at
before update on public.committees
for each row execute function private.set_updated_at();

create trigger committees_set_audit_fields
before insert or update on public.committees
for each row execute function private.set_audit_fields();

create trigger activities_set_updated_at
before update on public.activities
for each row execute function private.set_updated_at();

create trigger activities_set_audit_fields
before insert or update on public.activities
for each row execute function private.set_audit_fields();

create trigger tasks_set_updated_at
before update on public.tasks
for each row execute function private.set_updated_at();

create trigger tasks_set_audit_fields
before insert or update on public.tasks
for each row execute function private.set_audit_fields();

create trigger event_rsvps_set_updated_at
before update on public.event_rsvps
for each row execute function private.set_updated_at();

create trigger access_requests_set_updated_at
before update on public.access_requests
for each row execute function private.set_updated_at();

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.events enable row level security;
alter table public.stories enable row level security;
alter table public.site_settings enable row level security;
alter table public.proposals enable row level security;
alter table public.committees enable row level security;
alter table public.committee_members enable row level security;
alter table public.activities enable row level security;
alter table public.tasks enable row level security;
alter table public.event_rsvps enable row level security;
alter table public.access_requests enable row level security;
alter table public.media_assets enable row level security;

create policy profiles_select_own
on public.profiles for select
to authenticated
using ((select auth.uid()) = id);

create policy profiles_select_management
on public.profiles for select
to authenticated
using ((select private.has_any_role(array['club_manager', 'admin'])));

create policy profiles_update_own
on public.profiles for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy profiles_update_management
on public.profiles for update
to authenticated
using ((select private.has_any_role(array['club_manager', 'admin'])))
with check ((select private.has_any_role(array['club_manager', 'admin'])));

create policy memberships_select_own
on public.memberships for select
to authenticated
using ((select auth.uid()) = user_id);

create policy memberships_select_management
on public.memberships for select
to authenticated
using ((select private.has_any_role(array['club_manager', 'admin'])));

create policy memberships_update_management
on public.memberships for update
to authenticated
using ((select private.has_any_role(array['club_manager', 'admin'])))
with check ((select private.has_any_role(array['club_manager', 'admin'])));

create policy events_public_select
on public.events for select
to anon, authenticated
using (status = 'published' and is_public = true);

create policy events_content_select
on public.events for select
to authenticated
using ((select private.has_any_role(array['coordinator', 'editor', 'club_manager', 'admin'])));

create policy events_content_insert
on public.events for insert
to authenticated
with check ((select private.has_any_role(array['coordinator', 'editor', 'club_manager', 'admin'])));

create policy events_content_update
on public.events for update
to authenticated
using ((select private.has_any_role(array['coordinator', 'editor', 'club_manager', 'admin'])))
with check ((select private.has_any_role(array['coordinator', 'editor', 'club_manager', 'admin'])));

create policy events_content_delete
on public.events for delete
to authenticated
using ((select private.has_any_role(array['club_manager', 'admin'])));

create policy stories_public_select
on public.stories for select
to anon, authenticated
using (status = 'published' and is_public = true);

create policy stories_content_select
on public.stories for select
to authenticated
using ((select private.has_any_role(array['editor', 'club_manager', 'admin'])));

create policy stories_content_insert
on public.stories for insert
to authenticated
with check ((select private.has_any_role(array['editor', 'club_manager', 'admin'])));

create policy stories_content_update
on public.stories for update
to authenticated
using ((select private.has_any_role(array['editor', 'club_manager', 'admin'])))
with check ((select private.has_any_role(array['editor', 'club_manager', 'admin'])));

create policy stories_content_delete
on public.stories for delete
to authenticated
using ((select private.has_any_role(array['club_manager', 'admin'])));

create policy site_settings_public_select
on public.site_settings for select
to anon, authenticated
using (true);

create policy site_settings_management_update
on public.site_settings for update
to authenticated
using ((select private.has_any_role(array['club_manager', 'admin'])))
with check ((select private.has_any_role(array['club_manager', 'admin'])));

create policy proposals_select_own
on public.proposals for select
to authenticated
using ((select auth.uid()) = created_by);

create policy proposals_select_management
on public.proposals for select
to authenticated
using ((select private.has_any_role(array['coordinator', 'club_manager', 'admin'])));

create policy proposals_insert_member
on public.proposals for insert
to authenticated
with check (
  (select private.is_active_member())
  and (select auth.uid()) = created_by
);

create policy proposals_update_own
on public.proposals for update
to authenticated
using (
  (select auth.uid()) = created_by
  and status in ('draft', 'rejected')
)
with check (
  (select auth.uid()) = created_by
  and status in ('draft', 'submitted')
);

create policy proposals_update_management
on public.proposals for update
to authenticated
using ((select private.has_any_role(array['coordinator', 'club_manager', 'admin'])))
with check ((select private.has_any_role(array['coordinator', 'club_manager', 'admin'])));

create policy proposals_delete_own
on public.proposals for delete
to authenticated
using ((select auth.uid()) = created_by and status in ('draft', 'rejected'));

create policy proposals_delete_management
on public.proposals for delete
to authenticated
using ((select private.has_any_role(array['club_manager', 'admin'])));

create policy committees_select_member
on public.committees for select
to authenticated
using ((select private.is_active_member()) and is_active = true);

create policy committees_management_insert
on public.committees for insert
to authenticated
with check ((select private.has_any_role(array['coordinator', 'club_manager', 'admin'])));

create policy committees_management_update
on public.committees for update
to authenticated
using ((select private.has_any_role(array['coordinator', 'club_manager', 'admin'])))
with check ((select private.has_any_role(array['coordinator', 'club_manager', 'admin'])));

create policy committees_management_delete
on public.committees for delete
to authenticated
using ((select private.has_any_role(array['club_manager', 'admin'])));

create policy committee_members_select_member
on public.committee_members for select
to authenticated
using ((select private.is_active_member()));

create policy committee_members_management_insert
on public.committee_members for insert
to authenticated
with check ((select private.has_any_role(array['coordinator', 'club_manager', 'admin'])));

create policy committee_members_management_update
on public.committee_members for update
to authenticated
using ((select private.has_any_role(array['coordinator', 'club_manager', 'admin'])))
with check ((select private.has_any_role(array['coordinator', 'club_manager', 'admin'])));

create policy committee_members_management_delete
on public.committee_members for delete
to authenticated
using ((select private.has_any_role(array['coordinator', 'club_manager', 'admin'])));

create policy activities_select_member
on public.activities for select
to authenticated
using ((select private.is_active_member()));

create policy activities_management_insert
on public.activities for insert
to authenticated
with check ((select private.has_any_role(array['coordinator', 'club_manager', 'admin'])));

create policy activities_management_update
on public.activities for update
to authenticated
using ((select private.has_any_role(array['coordinator', 'club_manager', 'admin'])))
with check ((select private.has_any_role(array['coordinator', 'club_manager', 'admin'])));

create policy activities_management_delete
on public.activities for delete
to authenticated
using ((select private.has_any_role(array['club_manager', 'admin'])));

create policy tasks_select_member
on public.tasks for select
to authenticated
using ((select private.is_active_member()));

create policy tasks_management_insert
on public.tasks for insert
to authenticated
with check ((select private.has_any_role(array['coordinator', 'club_manager', 'admin'])));

create policy tasks_assignee_update
on public.tasks for update
to authenticated
using ((select auth.uid()) = assignee_id)
with check ((select auth.uid()) = assignee_id);

create policy tasks_management_update
on public.tasks for update
to authenticated
using ((select private.has_any_role(array['coordinator', 'club_manager', 'admin'])))
with check ((select private.has_any_role(array['coordinator', 'club_manager', 'admin'])));

create policy tasks_management_delete
on public.tasks for delete
to authenticated
using ((select private.has_any_role(array['club_manager', 'admin'])));

create policy event_rsvps_select_own
on public.event_rsvps for select
to authenticated
using ((select auth.uid()) = user_id);

create policy event_rsvps_select_management
on public.event_rsvps for select
to authenticated
using ((select private.has_any_role(array['coordinator', 'club_manager', 'admin'])));

create policy event_rsvps_insert_own
on public.event_rsvps for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and (select private.can_rsvp(event_id))
);

create policy event_rsvps_update_own
on public.event_rsvps for update
to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and (select private.can_rsvp(event_id))
);

create policy event_rsvps_delete_own
on public.event_rsvps for delete
to authenticated
using ((select auth.uid()) = user_id);

create policy access_requests_insert_public
on public.access_requests for insert
to anon, authenticated
with check (
  request_status = 'pending'
  and char_length(btrim(full_name)) between 2 and 160
  and char_length(email) <= 320
);

create policy access_requests_management_select
on public.access_requests for select
to authenticated
using ((select private.has_any_role(array['club_manager', 'admin'])));

create policy access_requests_management_update
on public.access_requests for update
to authenticated
using ((select private.has_any_role(array['club_manager', 'admin'])))
with check ((select private.has_any_role(array['club_manager', 'admin'])));

create policy access_requests_management_delete
on public.access_requests for delete
to authenticated
using ((select private.has_any_role(array['club_manager', 'admin'])));

create policy media_assets_select_own
on public.media_assets for select
to authenticated
using ((select auth.uid()) = uploaded_by);

create policy media_assets_select_management
on public.media_assets for select
to authenticated
using ((select private.has_any_role(array['editor', 'coordinator', 'club_manager', 'admin'])));

create policy media_assets_insert_member
on public.media_assets for insert
to authenticated
with check (
  (select private.is_active_member())
  and (select auth.uid()) = uploaded_by
);

create policy media_assets_update_own
on public.media_assets for update
to authenticated
using ((select auth.uid()) = uploaded_by)
with check ((select auth.uid()) = uploaded_by);

create policy media_assets_update_management
on public.media_assets for update
to authenticated
using ((select private.has_any_role(array['editor', 'coordinator', 'club_manager', 'admin'])))
with check ((select private.has_any_role(array['editor', 'coordinator', 'club_manager', 'admin'])));

create policy media_assets_delete_own
on public.media_assets for delete
to authenticated
using ((select auth.uid()) = uploaded_by);

create policy media_assets_delete_management
on public.media_assets for delete
to authenticated
using ((select private.has_any_role(array['editor', 'coordinator', 'club_manager', 'admin'])));

revoke all on table
  public.profiles,
  public.memberships,
  public.events,
  public.stories,
  public.site_settings,
  public.proposals,
  public.committees,
  public.committee_members,
  public.activities,
  public.tasks,
  public.event_rsvps,
  public.access_requests,
  public.media_assets
from anon, authenticated;

grant usage on schema public to anon, authenticated;

grant select, update on public.profiles to authenticated;
grant select, update on public.memberships to authenticated;
grant select, insert, update, delete on public.events to authenticated;
grant select, insert, update, delete on public.stories to authenticated;
grant select, update on public.site_settings to authenticated;
grant select, insert, update, delete on public.proposals to authenticated;
grant select, insert, update, delete on public.committees to authenticated;
grant select, insert, update, delete on public.committee_members to authenticated;
grant select, insert, update, delete on public.activities to authenticated;
grant select, insert, update, delete on public.tasks to authenticated;
grant select, insert, update, delete on public.event_rsvps to authenticated;
grant insert on public.access_requests to anon, authenticated;
grant select, update, delete on public.access_requests to authenticated;
grant select, insert, update, delete on public.media_assets to authenticated;

grant select on public.events, public.stories, public.site_settings to anon, authenticated;

grant execute on function private.has_any_role(text[]) to authenticated;
grant execute on function private.is_active_member() to authenticated;
grant execute on function private.can_rsvp(uuid) to authenticated;
grant execute on function private.set_updated_at() to anon, authenticated;
grant execute on function private.set_audit_fields() to authenticated;

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

create or replace function public.submit_proposal(_proposal_id uuid)
returns public.proposals
language plpgsql
security invoker
set search_path = ''
as $$
declare
  submitted public.proposals;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  update public.proposals as proposal
  set status = 'submitted',
      submitted_at = coalesce(proposal.submitted_at, now())
  where proposal.id = _proposal_id
    and proposal.created_by = (select auth.uid())
    and proposal.status in ('draft', 'rejected')
  returning proposal.* into submitted;

  if submitted.id is null then
    raise exception 'Proposal is not available for submission';
  end if;

  return submitted;
end;
$$;

revoke all on function public.claim_initial_admin() from public, anon, authenticated;
grant execute on function public.claim_initial_admin() to authenticated;
revoke all on function public.submit_proposal(uuid) from public, anon, authenticated;
grant execute on function public.submit_proposal(uuid) to authenticated;

insert into public.site_settings (id, site_name, tagline, public_email, timezone)
values (
  'club',
  'Club Rotario Santo Domingo Colonial',
  'Personas, ideas y servicio para construir una ciudad más conectada desde la Zona Colonial.',
  'club@rotariosantodomingo.org',
  'America/Santo_Domingo'
)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('club-public', 'club-public', true, 10485760,
    array['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']),
  ('club-media', 'club-media', false, 10485760,
    array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy club_public_assets_management_insert
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'club-public'
  and (select private.has_any_role(array['editor', 'club_manager', 'admin']))
);

create policy club_public_assets_management_update
on storage.objects for update
to authenticated
using (
  bucket_id = 'club-public'
  and (select private.has_any_role(array['editor', 'club_manager', 'admin']))
)
with check (
  bucket_id = 'club-public'
  and (select private.has_any_role(array['editor', 'club_manager', 'admin']))
);

create policy club_public_assets_management_delete
on storage.objects for delete
to authenticated
using (
  bucket_id = 'club-public'
  and (select private.has_any_role(array['editor', 'club_manager', 'admin']))
);

create policy club_media_own_read
on storage.objects for select
to authenticated
using (
  bucket_id = 'club-media'
  and (storage.foldername(name))[1] = ((select auth.uid())::text)
);

create policy club_media_management_read
on storage.objects for select
to authenticated
using (
  bucket_id = 'club-media'
  and (select private.has_any_role(array['editor', 'coordinator', 'club_manager', 'admin']))
);

create policy club_media_own_insert
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'club-media'
  and (select private.is_active_member())
  and (storage.foldername(name))[1] = ((select auth.uid())::text)
);

create policy club_media_own_update
on storage.objects for update
to authenticated
using (
  bucket_id = 'club-media'
  and (storage.foldername(name))[1] = ((select auth.uid())::text)
)
with check (
  bucket_id = 'club-media'
  and (storage.foldername(name))[1] = ((select auth.uid())::text)
);

create policy club_media_management_update
on storage.objects for update
to authenticated
using (
  bucket_id = 'club-media'
  and (select private.has_any_role(array['editor', 'coordinator', 'club_manager', 'admin']))
)
with check (
  bucket_id = 'club-media'
  and (select private.has_any_role(array['editor', 'coordinator', 'club_manager', 'admin']))
);

create policy club_media_own_delete
on storage.objects for delete
to authenticated
using (
  bucket_id = 'club-media'
  and (storage.foldername(name))[1] = ((select auth.uid())::text)
);

create policy club_media_management_delete
on storage.objects for delete
to authenticated
using (
  bucket_id = 'club-media'
  and (select private.has_any_role(array['editor', 'coordinator', 'club_manager', 'admin']))
);

alter default privileges in schema public
revoke all on tables from anon, authenticated;

alter default privileges in schema public
revoke all on sequences from anon, authenticated;
