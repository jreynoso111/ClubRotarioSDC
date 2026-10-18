-- Finance rules agreed with the club (2026-10-18):
-- 1. Void an entry with a mandatory reason; it stays visible but no longer counts.
-- 2. Notify members when a due is assigned, a payment is recorded or voided.
-- 3. Remind members with an outstanding due (private.send_dues_reminders, day 25).
-- 4. Year summary with cumulative cash balance (management).
-- 5. Members get a yearly statement (read through existing RLS).
-- 6. CSV export (application side).
-- 7. Coordination and the activity lead see the finances of their activity.
-- 8. Receipt attachments (private bucket) and numbered digital receipts.

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('general', 'message', 'event', 'proposal', 'membership', 'system', 'task', 'finance'));

alter table public.finance_entries
  add column voided_at timestamptz,
  add column voided_by uuid references public.profiles (id) on delete set null,
  add column void_reason text check (void_reason is null or char_length(btrim(void_reason)) between 5 and 500),
  add column receipt_number bigint unique,
  add column attachment_path text check (attachment_path is null or char_length(attachment_path) <= 300);
alter table public.finance_entries add constraint finance_entries_void_consistency
  check ((voided_at is null) = (void_reason is null));
alter table public.finance_monthly_dues add column reminder_sent_at timestamptz;

-- 8. Every income gets a correlative receipt number.
create sequence public.finance_receipt_seq;
revoke all on sequence public.finance_receipt_seq from public, anon, authenticated;
update public.finance_entries set receipt_number = numbered.n
from (select id, row_number() over (order by created_at, id) as n from public.finance_entries where direction = 'income') as numbered
where finance_entries.id = numbered.id;
select setval('public.finance_receipt_seq', greatest(coalesce((select max(receipt_number) from public.finance_entries), 0), 1),
  (select max(receipt_number) is not null from public.finance_entries));

create or replace function private.finance_assign_receipt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.direction = 'income' and new.receipt_number is null then
    new.receipt_number := nextval('public.finance_receipt_seq');
  end if;
  return new;
end;
$$;
create trigger finance_entries_receipt before insert on public.finance_entries
for each row execute function private.finance_assign_receipt();

create or replace function private.money(_amount numeric)
returns text
language sql
immutable
set search_path = ''
as $$ select 'RD$' || to_char(_amount, 'FM999,999,999,990.00'); $$;

create or replace function private.notify_finance_user(_user uuid, _title text, _body text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, kind, title, body, href)
  select _user, 'finance', left(_title, 180), left(_body, 1000), '/plataforma?tab=finanzas'
  where _user is not null and _user is distinct from (select auth.uid());
$$;

-- 1. Voiding.
create or replace function public.void_finance_entry(_entry_id uuid, _reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_finance_manager();
  if _entry_id is null or _reason is null or char_length(btrim(_reason)) not between 5 and 500 then
    raise exception 'A reason of 5 to 500 characters is required.' using errcode = '22023';
  end if;
  update public.finance_entries
  set voided_at = now(), voided_by = (select auth.uid()), void_reason = btrim(_reason)
  where id = _entry_id and voided_at is null;
  if not found then
    raise exception 'The entry was not found or is already voided.' using errcode = '22023';
  end if;
end;
$$;

-- Voided entries no longer count anywhere.
create or replace function public.get_finance_period_summary(_month_start date)
returns table (income_total numeric, expense_total numeric, balance numeric, dues_total numeric, dues_paid numeric, dues_outstanding numeric, dues_count integer)
language sql
stable
security invoker
set search_path = ''
as $$
  with period_entries as (
    select entry.direction, entry.amount
    from public.finance_entries as entry
    where entry.occurred_on >= _month_start
      and entry.occurred_on < (_month_start + interval '1 month')::date
      and entry.voided_at is null
      and (select private.is_active_member())
  ),
  entry_totals as (
    select
      coalesce(sum(amount) filter (where direction = 'income'), 0) as income_total,
      coalesce(sum(amount) filter (where direction = 'expense'), 0) as expense_total
    from period_entries
  ),
  period_dues as (
    select due.id, due.amount_due
    from public.finance_monthly_dues as due
    where due.due_month = _month_start
      and (select private.is_active_member())
  ),
  due_totals as (
    select
      coalesce(sum(due.amount_due), 0) as dues_total,
      coalesce(sum(least(due.amount_due, paid.amount_paid)), 0) as dues_paid,
      count(due.id)::integer as dues_count
    from period_dues as due
    left join lateral (
      select coalesce(sum(entry.amount), 0) as amount_paid
      from public.finance_entries as entry
      where entry.monthly_due_id = due.id and entry.voided_at is null
    ) as paid on true
  )
  select totals.income_total, totals.expense_total, totals.income_total - totals.expense_total,
    dues.dues_total, dues.dues_paid, dues.dues_total - dues.dues_paid, dues.dues_count
  from entry_totals as totals
  cross join due_totals as dues;
$$;

create or replace function public.get_finance_month_dues(_month_start date)
returns table (due_id uuid, member_id uuid, member_name text, due_month date, amount_due numeric, amount_paid numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  select due.id, due.member_id, due.member_name_snapshot, due.due_month, due.amount_due,
    coalesce(sum(entry.amount) filter (where entry.voided_at is null), 0) as amount_paid
  from public.finance_monthly_dues as due
  left join public.finance_entries as entry on entry.monthly_due_id = due.id
  where due.due_month = _month_start
    and (select private.is_active_member())
  group by due.id, due.member_id, due.member_name_snapshot, due.due_month, due.amount_due
  order by due.member_name_snapshot;
$$;

create or replace function public.get_finance_scope_totals(_month_start date, _member_id uuid default null, _activity_id uuid default null)
returns table(income_total numeric, expense_total numeric, entry_count bigint)
language sql stable security invoker set search_path = '' as $$
  select coalesce(sum(amount) filter (where direction = 'income' and voided_at is null), 0),
    coalesce(sum(amount) filter (where direction = 'expense' and voided_at is null), 0), count(*)
  from public.finance_entries
  where (select private.is_active_member())
    and occurred_on >= _month_start and occurred_on < (_month_start + interval '1 month')::date
    and (_member_id is null or member_id = _member_id)
    and (_activity_id is null or activity_id = _activity_id);
$$;

create or replace function public.record_finance_monthly_payment(
  _due_id uuid,
  _amount numeric,
  _occurred_on date,
  _payment_method text,
  _receipt_reference text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  due_row public.finance_monthly_dues%rowtype;
  already_paid numeric;
  entry_id uuid;
begin
  perform private.assert_finance_manager();
  if _due_id is null or _amount is null or _amount <= 0
    or _amount > 9999999999.99 or trunc(_amount, 2) <> _amount
    or _occurred_on is null
    or _occurred_on > (now() at time zone 'America/Santo_Domingo')::date
    or coalesce(_payment_method, 'other') not in ('cash', 'bank_transfer', 'card', 'check', 'other')
    or (_receipt_reference is not null and char_length(btrim(_receipt_reference)) > 120) then
    raise exception 'Invalid finance payment.' using errcode = '22023';
  end if;
  select due.* into due_row from public.finance_monthly_dues as due where due.id = _due_id for update;
  if not found then
    raise exception 'Monthly due was not found.' using errcode = '22023';
  end if;
  select coalesce(sum(entry.amount), 0) into already_paid
  from public.finance_entries as entry
  where entry.monthly_due_id = due_row.id and entry.voided_at is null;
  if already_paid + _amount > due_row.amount_due then
    raise exception 'Payment exceeds the remaining monthly due.' using errcode = '23514';
  end if;
  insert into public.finance_entries (
    direction, category, amount, currency, occurred_on, description,
    member_id, member_name_snapshot, monthly_due_id, payment_method, receipt_reference, created_by
  ) values (
    'income', 'monthly_dues', _amount, 'DOP', _occurred_on,
    'Aporte mensual · ' || to_char(due_row.due_month, 'YYYY-MM'),
    due_row.member_id, due_row.member_name_snapshot, due_row.id,
    coalesce(_payment_method, 'other'), nullif(btrim(_receipt_reference), ''), auth.uid()
  ) returning id into entry_id;
  return entry_id;
end;
$$;

-- 2. Notifications.
create or replace function private.finance_due_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.notify_finance_user(new.member_id, 'Cuota asignada',
    format('Cuota de %s: %s.', to_char(new.due_month, 'MM/YYYY'), private.money(new.amount_due)));
  return null;
end;
$$;
create trigger finance_monthly_dues_notify after insert on public.finance_monthly_dues
for each row execute function private.finance_due_notify();

create or replace function private.finance_entry_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.direction = 'income' then
    perform private.notify_finance_user(new.member_id, 'Pago registrado',
      format('Recibo N.º %s · %s · %s. Puedes ver el recibo en Finanzas.', new.receipt_number, private.money(new.amount), left(new.description, 200)));
  elsif tg_op = 'UPDATE' and new.voided_at is not null and old.voided_at is null then
    perform private.notify_finance_user(new.member_id, 'Movimiento anulado',
      format('%s · %s. Motivo: %s', left(new.description, 200), private.money(new.amount), left(new.void_reason, 300)));
  end if;
  return null;
end;
$$;
create trigger finance_entries_notify after insert or update on public.finance_entries
for each row execute function private.finance_entry_notify();

-- 3. Dues reminders, idempotent; the host scheduler runs it on day 25.
create or replace function private.send_dues_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  sent integer;
  current_month date := date_trunc('month', (now() at time zone 'America/Santo_Domingo'))::date;
begin
  with pending as (
    select due.id, due.member_id, due.due_month,
      due.amount_due - coalesce((select sum(entry.amount) from public.finance_entries as entry
        where entry.monthly_due_id = due.id and entry.voided_at is null), 0) as outstanding
    from public.finance_monthly_dues as due
    join public.memberships as membership on membership.user_id = due.member_id and membership.membership_status = 'active'
    where due.due_month = current_month and due.reminder_sent_at is null
  ), marked as (
    update public.finance_monthly_dues as due set reminder_sent_at = now()
    from pending where due.id = pending.id and pending.outstanding > 0
    returning pending.member_id, pending.due_month, pending.outstanding
  )
  insert into public.notifications (user_id, kind, title, body, href)
  select member_id, 'finance', 'Cuota pendiente',
    format('Tu cuota de %s tiene un saldo pendiente de %s.', to_char(due_month, 'MM/YYYY'), private.money(outstanding)),
    '/plataforma?tab=finanzas'
  from marked;
  get diagnostics sent = row_count;
  return sent;
end;
$$;

-- 4. Year summary with cumulative cash balance (management only).
create or replace function public.get_finance_year_summary(_year integer)
returns table (month_start date, income numeric, expense numeric, balance numeric, cumulative numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_finance_manager();
  if _year is null or _year < 1900 or _year > 2200 then
    raise exception 'Invalid year.' using errcode = '22023';
  end if;
  return query
  with months as (
    select generate_series(make_date(_year, 1, 1), make_date(_year, 12, 1), interval '1 month')::date as month_start
  ), totals as (
    select months.month_start,
      coalesce(sum(entry.amount) filter (where entry.direction = 'income'), 0) as income,
      coalesce(sum(entry.amount) filter (where entry.direction = 'expense'), 0) as expense
    from months
    left join public.finance_entries as entry
      on entry.voided_at is null and entry.occurred_on >= months.month_start
      and entry.occurred_on < (months.month_start + interval '1 month')::date
    group by months.month_start
  ), opening as (
    select coalesce(sum(case when direction = 'income' then amount else -amount end), 0) as amount
    from public.finance_entries where voided_at is null and occurred_on < make_date(_year, 1, 1)
  )
  select totals.month_start, totals.income, totals.expense, totals.income - totals.expense,
    (select amount from opening) + sum(totals.income - totals.expense) over (order by totals.month_start)
  from totals order by totals.month_start;
end;
$$;

-- 7. Finances of one activity for coordination and its lead.
create or replace function public.get_activity_finance(_activity_id uuid)
returns table (entry_id uuid, occurred_on date, direction text, category text, amount numeric, description text, party text, voided boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not (select private.is_active_member())
     or not ((select private.has_any_role(array['coordinator', 'club_manager', 'admin'])) or private.is_activity_lead(_activity_id)) then
    raise exception 'Coordination or the activity lead required.' using errcode = '42501';
  end if;
  return query
  select entry.id, entry.occurred_on, entry.direction, entry.category, entry.amount, entry.description,
    coalesce(entry.member_name_snapshot, entry.counterparty_name, 'Club'), entry.voided_at is not null
  from public.finance_entries as entry
  where entry.activity_id = _activity_id
  order by entry.occurred_on desc, entry.created_at desc
  limit 500;
end;
$$;

-- 8. Attachments in a private bucket: <entry_id>/<file>.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('club-finance-receipts', 'club-finance-receipts', false, 5242880, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
create policy finance_receipts_insert_management on storage.objects for insert to authenticated
with check (bucket_id = 'club-finance-receipts' and (select private.has_any_role(array['club_manager', 'admin'])));
create policy finance_receipts_delete_management on storage.objects for delete to authenticated
using (bucket_id = 'club-finance-receipts' and (select private.has_any_role(array['club_manager', 'admin'])));
create policy finance_receipts_select on storage.objects for select to authenticated
using (bucket_id = 'club-finance-receipts' and (
  (select private.has_any_role(array['club_manager', 'admin']))
  or exists (select 1 from public.finance_entries as entry
    where entry.id::text = (storage.foldername(name))[1] and entry.member_id = (select auth.uid()))));

create or replace function public.set_finance_entry_attachment(_entry_id uuid, _path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_finance_manager();
  if _entry_id is null or _path is null or left(_path, 37) <> _entry_id::text || '/' or char_length(_path) > 300 then
    raise exception 'The attachment must belong to the entry.' using errcode = '22023';
  end if;
  update public.finance_entries set attachment_path = _path where id = _entry_id;
  if not found then
    raise exception 'The entry was not found.' using errcode = '22023';
  end if;
end;
$$;

revoke all on function private.finance_assign_receipt() from public, anon, authenticated;
revoke all on function private.notify_finance_user(uuid, text, text) from public, anon, authenticated;
revoke all on function private.finance_due_notify() from public, anon, authenticated;
revoke all on function private.finance_entry_notify() from public, anon, authenticated;
revoke all on function private.send_dues_reminders() from public, anon, authenticated;
revoke all on function public.void_finance_entry(uuid, text) from public, anon;
grant execute on function public.void_finance_entry(uuid, text) to authenticated;
revoke all on function public.get_finance_year_summary(integer) from public, anon;
grant execute on function public.get_finance_year_summary(integer) to authenticated;
revoke all on function public.get_activity_finance(uuid) from public, anon;
grant execute on function public.get_activity_finance(uuid) to authenticated;
revoke all on function public.set_finance_entry_attachment(uuid, text) from public, anon;
grant execute on function public.set_finance_entry_attachment(uuid, text) to authenticated;
