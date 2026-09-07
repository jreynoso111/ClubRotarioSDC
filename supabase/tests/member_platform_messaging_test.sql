-- Manual integration contract for the member platform messaging migration.
-- Run as a database owner in the SQL editor. Every fixture is rolled back.
-- This deliberately avoids pgTAP so it can run in a normal Supabase SQL editor.

begin;

create temporary table member_platform_fixture (
  active_sender uuid not null,
  active_recipient uuid not null,
  pending_member uuid not null,
  suspended_member uuid not null
);

insert into member_platform_fixture
values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid());

-- The auth trigger creates profiles and pending memberships for each fixture.
insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
select fixture_id, gen_random_uuid(), 'authenticated', 'authenticated',
       fixture_id::text || '@member-platform.test', '', now(), '{}'::jsonb, '{}'::jsonb,
       now(), now()
from (
  select active_sender as fixture_id from member_platform_fixture
  union all select active_recipient from member_platform_fixture
  union all select pending_member from member_platform_fixture
  union all select suspended_member from member_platform_fixture
) as fixtures;

update public.memberships
set membership_status = 'active', joined_at = now()
where user_id in (
  (select active_sender from member_platform_fixture),
  (select active_recipient from member_platform_fixture)
);

update public.memberships
set membership_status = 'suspended'
where user_id = (select suspended_member from member_platform_fixture);

grant select on member_platform_fixture to authenticated;

-- Exercise the active-member path and its durable recipient notification.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claim.sub',
  (select active_sender::text from member_platform_fixture),
  true
);

select public.send_internal_message(
  array[(select active_recipient from member_platform_fixture)],
  'Mensaje de prueba',
  'Este mensaje vive dentro de la transacción de contrato.',
  'direct'
);

do $$
declare
  sent_count integer;
begin
  select count(*)::integer into sent_count
  from public.internal_messages
  where sender_id = (select active_sender from member_platform_fixture)
    and subject = 'Mensaje de prueba';

  if sent_count <> 1 then
    raise exception 'Expected one persisted message for the active sender, got %', sent_count;
  end if;
end;
$$;

-- The recipient can read its own inbox and its generated notification.
select set_config(
  'request.jwt.claim.sub',
  (select active_recipient::text from member_platform_fixture),
  true
);

do $$
declare
  message_count integer;
  notification_count integer;
begin
  select count(*)::integer into message_count
  from public.internal_messages
  where subject = 'Mensaje de prueba';

  select count(*)::integer into notification_count
  from public.notifications
  where kind = 'message' and read_at is null;

  if message_count <> 1 or notification_count <> 1 then
    raise exception 'Recipient RLS/notification contract failed: messages %, notifications %',
      message_count, notification_count;
  end if;
end;
$$;

-- Pending and suspended accounts cannot send, even though they are authenticated.
select set_config(
  'request.jwt.claim.sub',
  (select pending_member::text from member_platform_fixture),
  true
);

do $$
begin
  begin
    perform public.send_internal_message(
      array[(select active_sender from member_platform_fixture)],
      'No debe enviarse',
      'Una membresía pendiente no puede usar el buzón.',
      'direct'
    );
    raise exception 'Pending member was able to send a message';
  exception
    when others then
      if sqlerrm = 'Pending member was able to send a message' then
        raise;
      end if;
  end;
end;
$$;

select set_config(
  'request.jwt.claim.sub',
  (select suspended_member::text from member_platform_fixture),
  true
);

do $$
begin
  begin
    perform public.send_internal_message(
      array[(select active_sender from member_platform_fixture)],
      'Tampoco debe enviarse',
      'Una membresía suspendida no puede usar el buzón.',
      'direct'
    );
    raise exception 'Suspended member was able to send a message';
  exception
    when others then
      if sqlerrm = 'Suspended member was able to send a message' then
        raise;
      end if;
  end;
end;
$$;

-- The active sender cannot target a pending or suspended account.
select set_config(
  'request.jwt.claim.sub',
  (select active_sender::text from member_platform_fixture),
  true
);

do $$
begin
  begin
    perform public.send_internal_message(
      array[(select pending_member from member_platform_fixture)],
      'Destinatario inválido',
      'No debe persistirse.',
      'direct'
    );
    raise exception 'Active member was able to target a pending member';
  exception
    when others then
      if sqlerrm = 'Active member was able to target a pending member' then
        raise;
      end if;
  end;
end;
$$;

-- Notifications are server-created by the recipient trigger; clients cannot forge them.
do $$
begin
  begin
    insert into public.notifications (user_id, kind, title, body)
    values (
      (select active_recipient from member_platform_fixture),
      'system', 'Falsificación', 'No debe persistirse.'
    );
    raise exception 'Authenticated member was able to forge a notification';
  exception
    when others then
      if sqlerrm = 'Authenticated member was able to forge a notification' then
        raise;
      end if;
  end;
end;
$$;

rollback;
