-- Club finance: monthly obligations and an append-only DOP ledger.

create table public.finance_monthly_dues (
  id uuid primary key default gen_random_uuid(),
  due_month date not null,
  member_id uuid references public.profiles (id) on delete set null,
  member_name_snapshot text not null,
  amount_due numeric(12, 2) not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint finance_monthly_dues_first_day check (extract(day from due_month) = 1),
  constraint finance_monthly_dues_name_length check (char_length(btrim(member_name_snapshot)) between 1 and 120),
  constraint finance_monthly_dues_positive_amount check (amount_due > 0),
  constraint finance_monthly_dues_unique_member_month unique (member_id, due_month)
);

create index finance_monthly_dues_month_idx
  on public.finance_monthly_dues (due_month desc, member_name_snapshot);

create table public.finance_entries (
  id uuid primary key default gen_random_uuid(),
  direction text not null,
  category text not null,
  amount numeric(12, 2) not null,
  currency text not null default 'DOP',
  occurred_on date not null default (now() at time zone 'America/Santo_Domingo')::date,
  description text not null,
  member_id uuid references public.profiles (id) on delete set null,
  member_name_snapshot text,
  counterparty_name text,
  activity_id uuid references public.activities (id) on delete set null,
  activity_name_snapshot text,
  monthly_due_id uuid references public.finance_monthly_dues (id) on delete restrict,
  payment_method text not null default 'other',
  receipt_reference text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint finance_entries_direction_check check (direction in ('income', 'expense')),
  constraint finance_entries_category_direction_check check (
    (direction = 'income' and category in ('monthly_dues', 'activity_contribution', 'donation', 'other_income'))
    or (direction = 'expense' and category in ('activity_expense', 'operating_expense', 'other_expense'))
  ),
  constraint finance_entries_positive_amount check (amount > 0),
  constraint finance_entries_dop_currency check (currency = 'DOP'),
  constraint finance_entries_description_length check (char_length(btrim(description)) between 3 and 500),
  constraint finance_entries_member_name_length check (member_name_snapshot is null or char_length(btrim(member_name_snapshot)) <= 120),
  constraint finance_entries_counterparty_name_length check (counterparty_name is null or char_length(btrim(counterparty_name)) <= 120),
  constraint finance_entries_activity_name_length check (activity_name_snapshot is null or char_length(btrim(activity_name_snapshot)) <= 180),
  constraint finance_entries_reference_length check (receipt_reference is null or char_length(btrim(receipt_reference)) <= 120),
  constraint finance_entries_payment_method_check check (payment_method in ('cash', 'bank_transfer', 'card', 'check', 'other')),
  constraint finance_entries_monthly_due_link check ((category = 'monthly_dues') = (monthly_due_id is not null)),
  constraint finance_entries_activity_link check (
    category not in ('activity_contribution', 'activity_expense') or activity_id is not null
  )
);

create index finance_entries_date_idx
  on public.finance_entries (occurred_on desc, created_at desc, id desc);
create index finance_entries_member_date_idx
  on public.finance_entries (member_id, occurred_on desc, id desc)
  where member_id is not null;
create index finance_entries_due_idx
  on public.finance_entries (monthly_due_id)
  where monthly_due_id is not null;
create index finance_entries_activity_idx
  on public.finance_entries (activity_id, occurred_on desc)
  where activity_id is not null;

alter table public.finance_monthly_dues enable row level security;
alter table public.finance_entries enable row level security;
revoke all on public.finance_monthly_dues, public.finance_entries from public, anon, authenticated, service_role;
grant select on public.finance_monthly_dues, public.finance_entries to authenticated;

create policy finance_monthly_dues_read_own_or_management
on public.finance_monthly_dues for select
to authenticated
using (
  (select private.is_active_member())
  and (
    (select private.has_any_role(array['club_manager', 'admin']))
    or member_id = (select auth.uid())
  )
);

create policy finance_entries_read_own_or_management
on public.finance_entries for select
to authenticated
using (
  (select private.is_active_member())
  and (
    (select private.has_any_role(array['club_manager', 'admin']))
    or (direction = 'income' and member_id = (select auth.uid()))
  )
);

-- The existing club audit writer records before/after snapshots for both tables.
create trigger zz_club_audit after insert or update or delete on public.finance_monthly_dues
for each row execute function private.capture_club_audit_change('id');
create trigger zz_club_audit after insert or update or delete on public.finance_entries
for each row execute function private.capture_club_audit_change('id');

create function public.get_finance_period_summary(_month_start date)
returns table (
  income_total numeric,
  expense_total numeric,
  balance numeric,
  dues_total numeric,
  dues_paid numeric,
  dues_outstanding numeric,
  dues_count integer
)
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
      where entry.monthly_due_id = due.id
    ) as paid on true
  )
  select
    totals.income_total,
    totals.expense_total,
    totals.income_total - totals.expense_total,
    dues.dues_total,
    dues.dues_paid,
    dues.dues_total - dues.dues_paid,
    dues.dues_count
  from entry_totals as totals
  cross join due_totals as dues;
$$;

create function public.get_finance_month_dues(_month_start date)
returns table (
  due_id uuid,
  member_id uuid,
  member_name text,
  due_month date,
  amount_due numeric,
  amount_paid numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    due.id,
    due.member_id,
    due.member_name_snapshot,
    due.due_month,
    due.amount_due,
    coalesce(sum(entry.amount), 0) as amount_paid
  from public.finance_monthly_dues as due
  left join public.finance_entries as entry on entry.monthly_due_id = due.id
  where due.due_month = _month_start
    and (select private.is_active_member())
  group by due.id, due.member_id, due.member_name_snapshot, due.due_month, due.amount_due
  order by due.member_name_snapshot;
$$;

create function private.assert_finance_manager()
returns void
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null
    or not (select private.is_active_member())
    or not (select private.has_any_role(array['club_manager', 'admin'])) then
    raise exception 'Active club management membership required.' using errcode = '42501';
  end if;
end;
$$;
revoke all on function private.assert_finance_manager() from public, anon, authenticated, service_role;

create function public.create_finance_monthly_dues(_due_month date, _amount_due numeric)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_count integer;
begin
  perform private.assert_finance_manager();
  if _due_month is null or extract(day from _due_month) <> 1
    or _amount_due is null or _amount_due <= 0
    or _amount_due > 9999999999.99 or trunc(_amount_due, 2) <> _amount_due then
    raise exception 'Invalid monthly due period or amount.' using errcode = '22023';
  end if;

  insert into public.finance_monthly_dues (
    due_month, member_id, member_name_snapshot, amount_due, created_by
  )
  select
    _due_month,
    membership.user_id,
    coalesce(nullif(btrim(profile.display_name), ''), 'Miembro del club'),
    _amount_due,
    auth.uid()
  from public.memberships as membership
  join public.profiles as profile on profile.id = membership.user_id
  where membership.membership_status = 'active'
  on conflict (member_id, due_month) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

create function public.create_finance_entry(
  _direction text,
  _category text,
  _amount numeric,
  _occurred_on date,
  _description text,
  _member_id uuid default null,
  _counterparty_name text default null,
  _activity_id uuid default null,
  _payment_method text default 'other',
  _receipt_reference text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  member_name text;
  activity_name text;
  entry_id uuid;
begin
  perform private.assert_finance_manager();
  if _direction is null or _category is null
    or _direction not in ('income', 'expense')
    or _category not in (
      'activity_contribution', 'donation', 'other_income',
      'activity_expense', 'operating_expense', 'other_expense'
    )
    or (_direction = 'income' and _category not in ('activity_contribution', 'donation', 'other_income'))
    or (_direction = 'expense' and _category not in ('activity_expense', 'operating_expense', 'other_expense'))
    or _amount is null or _amount <= 0 or _amount > 9999999999.99
    or trunc(_amount, 2) <> _amount
    or _occurred_on is null
    or _occurred_on > (now() at time zone 'America/Santo_Domingo')::date
    or _description is null or char_length(btrim(_description)) not between 3 and 500
    or coalesce(_payment_method, 'other') not in ('cash', 'bank_transfer', 'card', 'check', 'other')
    or (_counterparty_name is not null and char_length(btrim(_counterparty_name)) > 120)
    or (_receipt_reference is not null and char_length(btrim(_receipt_reference)) > 120)
    or (_category in ('activity_contribution', 'activity_expense') and _activity_id is null) then
    raise exception 'Invalid finance entry.' using errcode = '22023';
  end if;

  if _member_id is not null then
    select coalesce(nullif(btrim(profile.display_name), ''), 'Miembro del club')
      into member_name
    from public.profiles as profile
    where profile.id = _member_id;
    if not found then
      raise exception 'Finance member was not found.' using errcode = '22023';
    end if;
  end if;

  if _activity_id is not null then
    select activity.title into activity_name
    from public.activities as activity
    where activity.id = _activity_id;
    if not found then
      raise exception 'Finance activity was not found.' using errcode = '22023';
    end if;
  end if;

  insert into public.finance_entries (
    direction, category, amount, currency, occurred_on, description,
    member_id, member_name_snapshot, counterparty_name,
    activity_id, activity_name_snapshot, payment_method, receipt_reference, created_by
  ) values (
    _direction, _category, _amount, 'DOP', _occurred_on, btrim(_description),
    _member_id, member_name, nullif(btrim(_counterparty_name), ''),
    _activity_id, activity_name, coalesce(_payment_method, 'other'),
    nullif(btrim(_receipt_reference), ''), auth.uid()
  ) returning id into entry_id;

  return entry_id;
end;
$$;

create function public.record_finance_monthly_payment(
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

  select due.* into due_row
  from public.finance_monthly_dues as due
  where due.id = _due_id
  for update;
  if not found then
    raise exception 'Monthly due was not found.' using errcode = '22023';
  end if;

  select coalesce(sum(entry.amount), 0) into already_paid
  from public.finance_entries as entry
  where entry.monthly_due_id = due_row.id;
  if already_paid + _amount > due_row.amount_due then
    raise exception 'Payment exceeds the remaining monthly due.' using errcode = '23514';
  end if;

  insert into public.finance_entries (
    direction, category, amount, currency, occurred_on, description,
    member_id, member_name_snapshot, monthly_due_id,
    payment_method, receipt_reference, created_by
  ) values (
    'income', 'monthly_dues', _amount, 'DOP', _occurred_on,
    'Aporte mensual · ' || to_char(due_row.due_month, 'YYYY-MM'),
    due_row.member_id, due_row.member_name_snapshot, due_row.id,
    coalesce(_payment_method, 'other'), nullif(btrim(_receipt_reference), ''), auth.uid()
  ) returning id into entry_id;

  return entry_id;
end;
$$;

revoke all on function public.get_finance_period_summary(date) from public, anon, authenticated;
revoke all on function public.get_finance_month_dues(date) from public, anon, authenticated;
revoke all on function public.create_finance_monthly_dues(date, numeric) from public, anon, authenticated, service_role;
revoke all on function public.create_finance_entry(text, text, numeric, date, text, uuid, text, uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.record_finance_monthly_payment(uuid, numeric, date, text, text) from public, anon, authenticated, service_role;
grant execute on function public.get_finance_period_summary(date) to authenticated;
grant execute on function public.get_finance_month_dues(date) to authenticated;
grant execute on function public.create_finance_monthly_dues(date, numeric) to authenticated;
grant execute on function public.create_finance_entry(text, text, numeric, date, text, uuid, text, uuid, text, text) to authenticated;
grant execute on function public.record_finance_monthly_payment(uuid, numeric, date, text, text) to authenticated;

notify pgrst, 'reload schema';
