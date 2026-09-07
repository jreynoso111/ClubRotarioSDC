-- Member platform: private conversations, club announcements, and durable notifications.
-- This migration is additive. It does not alter existing membership rows.

-- The initial bootstrap RPC was useful during first setup, but must not remain
-- callable once the club has a real membership approval flow.
revoke all on function public.claim_initial_admin() from public, anon, authenticated;
revoke all on function private.claim_initial_admin_internal() from public, anon, authenticated;

create table public.internal_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  subject text not null,
  body text not null,
  audience_type text not null default 'direct',
  created_at timestamptz not null default now(),
  constraint internal_messages_subject_length
    check (char_length(btrim(subject)) between 3 and 180),
  constraint internal_messages_body_length
    check (char_length(btrim(body)) between 1 and 8000),
  constraint internal_messages_audience_check
    check (audience_type in ('direct', 'all_members'))
);

create table public.internal_message_recipients (
  message_id uuid not null references public.internal_messages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null default 'general',
  title text not null,
  body text not null,
  href text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notifications_kind_check
    check (kind in ('general', 'message', 'event', 'proposal', 'membership', 'system')),
  constraint notifications_title_length
    check (char_length(btrim(title)) between 2 and 180),
  constraint notifications_body_length
    check (char_length(btrim(body)) between 1 and 1000),
  constraint notifications_href_check
    check (href is null or href ~ '^/')
);

create index internal_messages_sender_created_idx
  on public.internal_messages (sender_id, created_at desc, id);
create index internal_message_recipients_user_created_idx
  on public.internal_message_recipients (user_id, created_at desc, message_id);
create index notifications_user_created_idx
  on public.notifications (user_id, created_at desc, id);
create index notifications_unread_idx
  on public.notifications (user_id, created_at desc, id)
  where read_at is null;

create or replace function private.is_active_user(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships as membership
    where membership.user_id = _user_id
      and membership.membership_status = 'active'
  );
$$;

create or replace function private.is_message_recipient(_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.internal_message_recipients as recipient
    where recipient.message_id = _message_id
      and recipient.user_id = (select auth.uid())
  );
$$;

create or replace function private.is_first_message_recipient(_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
    from public.internal_message_recipients as recipient
    where recipient.message_id = _message_id
  );
$$;

revoke all on function private.is_active_user(uuid) from public, anon, authenticated;
revoke all on function private.is_message_recipient(uuid) from public, anon, authenticated;
revoke all on function private.is_first_message_recipient(uuid) from public, anon, authenticated;
grant execute on function private.is_active_user(uuid) to authenticated;
grant execute on function private.is_message_recipient(uuid) to authenticated;
grant execute on function private.is_first_message_recipient(uuid) to authenticated;

create or replace function private.notify_message_recipient()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (user_id, kind, title, body, href)
  select
    new.user_id,
    'message',
    'Nuevo mensaje del club',
    left(message.subject, 100),
    '/plataforma?tab=mensajes'
  from public.internal_messages as message
  where message.id = new.message_id;

  return new;
end;
$$;

revoke all on function private.notify_message_recipient() from public, anon, authenticated;

create trigger internal_message_recipients_notify
after insert on public.internal_message_recipients
for each row execute function private.notify_message_recipient();

alter table public.internal_messages enable row level security;
alter table public.internal_message_recipients enable row level security;
alter table public.notifications enable row level security;

create policy internal_messages_select_sent
on public.internal_messages for select
to authenticated
using (
  (select private.is_active_member())
  and (select auth.uid()) = sender_id
);

create policy internal_messages_select_received
on public.internal_messages for select
to authenticated
using (
  (select private.is_active_member())
  and (select private.is_message_recipient(id))
);

create policy internal_messages_insert_active_member
on public.internal_messages for insert
to authenticated
with check (
  (select private.is_active_member())
  and (select auth.uid()) = sender_id
  and (
    audience_type = 'direct'
    or (select private.has_any_role(array['coordinator', 'club_manager', 'admin']))
  )
);

create policy internal_message_recipients_select_own
on public.internal_message_recipients for select
to authenticated
using (
  (select private.is_active_member())
  and (select auth.uid()) = user_id
);

create policy internal_message_recipients_select_sender
on public.internal_message_recipients for select
to authenticated
using (
  (select private.is_active_member())
  and exists (
    select 1
    from public.internal_messages as message
    where message.id = message_id
      and message.sender_id = (select auth.uid())
  )
);

create policy internal_message_recipients_insert_sender
on public.internal_message_recipients for insert
to authenticated
with check (
  (select private.is_active_member())
  and exists (
    select 1
    from public.internal_messages as message
    where message.id = message_id
      and message.sender_id = (select auth.uid())
      and (
        (
          message.audience_type = 'direct'
          and (select private.is_first_message_recipient(message.id))
        )
        or (
          message.audience_type = 'all_members'
          and (select private.has_any_role(array['coordinator', 'club_manager', 'admin']))
        )
      )
  )
  and (select private.is_active_user(user_id))
);

create policy internal_message_recipients_update_own
on public.internal_message_recipients for update
to authenticated
using (
  (select private.is_active_member())
  and (select auth.uid()) = user_id
)
with check (
  (select private.is_active_member())
  and (select auth.uid()) = user_id
);

create policy notifications_select_own
on public.notifications for select
to authenticated
using (
  (select private.is_active_member())
  and (select auth.uid()) = user_id
);

create policy notifications_update_own
on public.notifications for update
to authenticated
using (
  (select private.is_active_member())
  and (select auth.uid()) = user_id
)
with check (
  (select private.is_active_member())
  and (select auth.uid()) = user_id
);

-- Active members may discover only the names needed by the internal directory.
-- RLS protects rows; the DAL still selects a minimal field set.
create policy profiles_select_active_member_directory
on public.profiles for select
to authenticated
using (
  (select private.is_active_member())
  and (select private.is_active_user(id))
);

revoke all on table
  public.internal_messages,
  public.internal_message_recipients,
  public.notifications
from anon, authenticated;

grant select, insert on public.internal_messages to authenticated;
grant select, insert, update (read_at) on public.internal_message_recipients to authenticated;
grant select, update (read_at) on public.notifications to authenticated;

create or replace function public.send_internal_message(
  _recipient_ids uuid[],
  _subject text,
  _body text,
  _audience_type text default 'direct'
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  message_id uuid;
begin
  if actor_id is null or not (select private.is_active_member()) then
    raise exception 'Active membership required';
  end if;

  if char_length(btrim(coalesce(_subject, ''))) not between 3 and 180 then
    raise exception 'Message subject is invalid';
  end if;

  if char_length(btrim(coalesce(_body, ''))) not between 1 and 8000 then
    raise exception 'Message body is invalid';
  end if;

  if _audience_type not in ('direct', 'all_members') then
    raise exception 'Message audience is invalid';
  end if;

  if coalesce(array_length(_recipient_ids, 1), 0) = 0
     or coalesce(array_length(_recipient_ids, 1), 0) > 500 then
    raise exception 'Message recipients are invalid';
  end if;

  if _audience_type = 'direct' and array_length(_recipient_ids, 1) <> 1 then
    raise exception 'Direct messages require one recipient';
  end if;

  if exists (
    select 1
    from unnest(_recipient_ids) as recipient(user_id)
    where not (select private.is_active_user(recipient.user_id))
  ) then
    raise exception 'Every recipient must be an active member';
  end if;

  insert into public.internal_messages (sender_id, subject, body, audience_type)
  values (actor_id, btrim(_subject), btrim(_body), _audience_type)
  returning id into message_id;

  insert into public.internal_message_recipients (message_id, user_id)
  select message_id, recipient.user_id
  from (
    select distinct user_id
    from unnest(_recipient_ids) as values_list(user_id)
  ) as recipient;

  return message_id;
end;
$$;

revoke all on function public.send_internal_message(uuid[], text, text, text)
from public, anon, authenticated;
grant execute on function public.send_internal_message(uuid[], text, text, text) to authenticated;
