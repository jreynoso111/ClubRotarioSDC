-- Activities and tasks rules agreed with the club (2026-10-18):
-- 1. Notify a member when a task is assigned or its date or priority changes,
--    and the lead when an activity is assigned to them.
-- 2. Management (club_manager, admin) can delete activities and tasks.
-- 3. Closing an activity cancels its open tasks (the interface warns first).
-- 4. One reminder the day before a task is due (private.send_task_reminders,
--    run daily by the host scheduler).
-- 5. The lead of an activity manages the tasks of that activity.
-- 6. Activities can be linked to a draft Agenda event (events.activity_id).
-- 7. Task comments; blocking a task records its reason as a comment.

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('general', 'message', 'event', 'proposal', 'membership', 'system', 'task'));

alter table public.tasks add column reminder_sent_at timestamptz;
alter table public.events add column activity_id uuid references public.activities (id) on delete set null;
create index events_activity_idx on public.events (activity_id) where activity_id is not null;

create or replace function private.is_activity_lead(_activity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select _activity_id is not null and (select private.is_active_member()) and exists (
    select 1 from public.activities where id = _activity_id and lead_id = (select auth.uid()));
$$;

-- 5. Leads manage the tasks of their activity.
drop policy tasks_management_insert on public.tasks;
create policy tasks_management_insert on public.tasks for insert to authenticated
with check ((select private.has_any_role(array['coordinator', 'club_manager', 'admin'])) or private.is_activity_lead(activity_id));
create policy tasks_lead_update on public.tasks for update to authenticated
using (private.is_activity_lead(activity_id))
with check (private.is_activity_lead(activity_id));

create or replace function private.guard_task_assignee()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'authenticated'
     or (select private.has_any_role(array['coordinator', 'club_manager', 'admin']))
     or private.is_activity_lead(old.activity_id) then
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

create or replace function private.notify_task_users(_users uuid[], _title text, _body text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, kind, title, body, href)
  select distinct recipient, 'task', left(_title, 180), left(_body, 1000), '/plataforma?tab=actividades'
  from unnest(_users) as recipient
  where recipient is not null and recipient is distinct from (select auth.uid());
$$;

create or replace function private.task_label(_task public.tasks)
returns text
language sql
stable
set search_path = ''
as $$
  select format('«%s»%s', left(_task.title, 140),
    coalesce(' · vence ' || to_char(_task.due_at at time zone 'America/Santo_Domingo', 'DD/MM/YY HH24:MI'), ''));
$$;

-- A new due date earns a new reminder.
create or replace function private.task_reset_reminder()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.due_at is distinct from old.due_at or new.assignee_id is distinct from old.assignee_id then
    new.reminder_sent_at := null;
  end if;
  return new;
end;
$$;
create trigger tasks_reset_reminder before update on public.tasks
for each row execute function private.task_reset_reminder();

-- 1. Task notifications.
create or replace function private.task_after_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assignee_id is not null and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) then
    perform private.notify_task_users(array[new.assignee_id], 'Nueva tarea asignada', private.task_label(new));
  elsif tg_op = 'UPDATE' and new.assignee_id is not null
    and (new.due_at, new.priority) is distinct from (old.due_at, old.priority)
    and new.task_status not in ('done', 'cancelled') then
    perform private.notify_task_users(array[new.assignee_id], 'Cambio en tu tarea',
      private.task_label(new) || ' · prioridad ' || case new.priority when 'low' then 'baja' when 'high' then 'alta' when 'urgent' then 'urgente' else 'normal' end);
  end if;
  return null;
end;
$$;
create trigger tasks_after_change after insert or update on public.tasks
for each row execute function private.task_after_change();

-- 1 and 3. Lead notification; closing an activity cancels its open tasks.
create or replace function private.activity_after_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.lead_id is not null and (tg_op = 'INSERT' or new.lead_id is distinct from old.lead_id) then
    perform private.notify_task_users(array[new.lead_id], 'Eres responsable de una actividad',
      format('«%s». Puedes organizar sus tareas.', left(new.title, 160)));
  end if;
  if tg_op = 'UPDATE' and new.activity_status in ('completed', 'cancelled') and old.activity_status not in ('completed', 'cancelled') then
    insert into public.task_comments (task_id, author_id, body)
    select id, (select auth.uid()), 'Cancelada al cerrar la actividad.'
    from public.tasks where activity_id = new.id and task_status in ('todo', 'in_progress', 'blocked');
    update public.tasks set task_status = 'cancelled', completed_at = null
    where activity_id = new.id and task_status in ('todo', 'in_progress', 'blocked');
  end if;
  return null;
end;
$$;

-- 7. Comments.
create table public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null default auth.uid(),
  body text not null check (char_length(btrim(body)) between 2 and 2000),
  created_at timestamptz not null default now()
);
create index task_comments_task_idx on public.task_comments (task_id, created_at);
create trigger zz_club_audit after insert or update or delete on public.task_comments
for each row execute function private.capture_club_audit_change('id');
alter table public.task_comments enable row level security;
revoke all on public.task_comments from anon, authenticated;
grant select, insert on public.task_comments to authenticated;
create policy task_comments_select on public.task_comments for select to authenticated
using ((select private.is_active_member()));
-- Coordination, the assignee and the activity lead can comment.
create policy task_comments_insert on public.task_comments for insert to authenticated
with check (author_id = (select auth.uid()) and (select private.is_active_member()) and exists (
  select 1 from public.tasks as task where task.id = task_comments.task_id and (
    (select private.has_any_role(array['coordinator', 'club_manager', 'admin']))
    or task.assignee_id = (select auth.uid())
    or private.is_activity_lead(task.activity_id))));

create trigger activities_after_change after insert or update on public.activities
for each row execute function private.activity_after_change();

create or replace function private.task_comment_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.tasks;
  lead uuid;
begin
  select * into target from public.tasks where id = new.task_id;
  select lead_id into lead from public.activities where id = target.activity_id;
  -- Closing an activity writes its own comments; those are not news.
  if new.body = 'Cancelada al cerrar la actividad.' then
    return null;
  end if;
  perform private.notify_task_users(array[target.assignee_id, lead], 'Comentario en una tarea',
    format('«%s»: %s', left(target.title, 100), left(new.body, 300)));
  return null;
end;
$$;
create trigger task_comments_notify after insert on public.task_comments
for each row execute function private.task_comment_notify();

-- 4. Reminders, idempotent; the host scheduler calls it daily.
create or replace function private.send_task_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  sent integer;
begin
  with due as (
    update public.tasks set reminder_sent_at = now()
    where assignee_id is not null and reminder_sent_at is null
      and task_status in ('todo', 'in_progress', 'blocked')
      and due_at > now() and due_at <= now() + interval '24 hours'
    returning id
  )
  insert into public.notifications (user_id, kind, title, body, href)
  select task.assignee_id, 'task', 'Tu tarea vence pronto', private.task_label(task), '/plataforma?tab=actividades'
  from due join public.tasks as task on task.id = due.id;
  get diagnostics sent = row_count;
  return sent;
end;
$$;

revoke all on function private.is_activity_lead(uuid) from public, anon;
grant execute on function private.is_activity_lead(uuid) to authenticated;
revoke all on function private.notify_task_users(uuid[], text, text) from public, anon, authenticated;
revoke all on function private.task_label(public.tasks) from public, anon, authenticated;
revoke all on function private.task_reset_reminder() from public, anon, authenticated;
revoke all on function private.task_after_change() from public, anon, authenticated;
revoke all on function private.activity_after_change() from public, anon, authenticated;
revoke all on function private.task_comment_notify() from public, anon, authenticated;
revoke all on function private.send_task_reminders() from public, anon, authenticated;
