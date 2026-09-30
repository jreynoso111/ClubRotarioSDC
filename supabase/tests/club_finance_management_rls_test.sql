begin;
select plan(18);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.finance_monthly_dues'::regclass),
  'monthly obligations are protected by row-level security'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.finance_entries'::regclass),
  'income and expense records are protected by row-level security'
);
select ok(
  has_table_privilege('authenticated', 'public.finance_entries', 'SELECT')
    and not has_table_privilege('authenticated', 'public.finance_entries', 'INSERT')
    and not has_table_privilege('authenticated', 'public.finance_entries', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.finance_entries', 'DELETE'),
  'members can read permitted ledger rows but cannot edit the append-only ledger directly'
);
select ok(
  not has_table_privilege('anon', 'public.finance_entries', 'SELECT')
    and not has_table_privilege('anon', 'public.finance_monthly_dues', 'SELECT'),
  'anonymous users cannot inspect financial data'
);
select ok(
  has_function_privilege('authenticated', 'public.create_finance_monthly_dues(date,numeric)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.create_finance_entry(text,text,numeric,date,text,uuid,text,uuid,text,text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.record_finance_monthly_payment(uuid,numeric,date,text,text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.create_finance_entry(text,text,numeric,date,text,uuid,text,uuid,text,text)', 'EXECUTE'),
  'only authenticated clients can call finance operations'
);
select is(
  (select count(*)::integer from pg_policies
    where schemaname = 'public'
      and tablename in ('finance_monthly_dues', 'finance_entries')
      and policyname in ('finance_monthly_dues_read_own_or_management', 'finance_entries_read_own_or_management')),
  2,
  'member and finance-manager read policies cover both tables'
);

create temporary table finance_fixture (
  manager_id uuid not null,
  member_id uuid not null,
  other_member_id uuid not null,
  coordinator_id uuid not null,
  suspended_id uuid not null,
  activity_id uuid not null,
  due_month date not null
);
insert into finance_fixture values (
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), date_trunc('month', now() at time zone 'America/Santo_Domingo')::date
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select fixture_id, gen_random_uuid(), 'authenticated', 'authenticated',
       fixture_id::text || '@club-finance.test', '', now(), '{}'::jsonb, '{}'::jsonb,
       now(), now()
from (
  select manager_id as fixture_id from finance_fixture
  union all select member_id from finance_fixture
  union all select other_member_id from finance_fixture
  union all select coordinator_id from finance_fixture
  union all select suspended_id from finance_fixture
) as fixtures;

update public.profiles
set display_name = case id
  when (select manager_id from finance_fixture) then 'Administración de prueba'
  when (select member_id from finance_fixture) then 'Miembro Uno'
  when (select other_member_id from finance_fixture) then 'Miembro Dos'
  else 'Miembro de prueba'
end
where id in (
  (select manager_id from finance_fixture),
  (select member_id from finance_fixture),
  (select other_member_id from finance_fixture),
  (select coordinator_id from finance_fixture),
  (select suspended_id from finance_fixture)
);

update public.memberships
set membership_role = case
      when user_id = (select manager_id from finance_fixture) then 'club_manager'
      when user_id = (select coordinator_id from finance_fixture) then 'coordinator'
      else 'member'
    end,
    membership_status = case
      when user_id = (select suspended_id from finance_fixture) then 'suspended'
      else 'active'
    end
where user_id in (
  (select manager_id from finance_fixture),
  (select member_id from finance_fixture),
  (select other_member_id from finance_fixture),
  (select coordinator_id from finance_fixture),
  (select suspended_id from finance_fixture)
);

insert into public.activities (id, title, slug, activity_status)
select activity_id, 'Servicio financiero de prueba', 'club-finance-test', 'planned'
from finance_fixture;

create temporary table finance_created_entries (
  entry_kind text primary key,
  entry_id uuid not null
);
grant select, insert on finance_fixture, finance_created_entries to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', (select manager_id::text from finance_fixture), true);

select is(
  public.create_finance_monthly_dues(
    (select due_month from finance_fixture), 500.00
  ),
  (select count(*)::integer from public.memberships where membership_status = 'active'),
  'a finance manager creates one monthly obligation for every active member'
);
select ok(
  exists (
    select 1 from public.finance_monthly_dues as due
    where due.member_id = (select member_id from finance_fixture)
      and due.due_month = (select due_month from finance_fixture)
      and due.amount_due = 500.00
      and due.created_by = (select manager_id from finance_fixture)
      and due.member_name_snapshot = 'Miembro Uno'
  ),
  'each obligation retains its member, amount, period, and creator'
);

insert into finance_created_entries (entry_kind, entry_id)
select 'activity', public.create_finance_entry(
  'income', 'activity_contribution', 250.00,
  (now() at time zone 'America/Santo_Domingo')::date,
  'Aporte de prueba para la actividad',
  (select member_id from finance_fixture), null,
  (select activity_id from finance_fixture), 'bank_transfer', 'FIN-100'
);
insert into finance_created_entries (entry_kind, entry_id)
select 'donation', public.create_finance_entry(
  'income', 'donation', 100.00,
  (now() at time zone 'America/Santo_Domingo')::date,
  'Donación de prueba',
  (select other_member_id from finance_fixture), null, null, 'cash', null
);

select public.record_finance_monthly_payment(
  (select id from public.finance_monthly_dues
    where member_id = (select member_id from finance_fixture)
      and due_month = (select due_month from finance_fixture)),
  125.50,
  (now() at time zone 'America/Santo_Domingo')::date,
  'cash',
  'FIN-DUE-1'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', (select member_id::text from finance_fixture), true);

select is(
  (select count(*)::integer from public.finance_monthly_dues
    where due_month = (select due_month from finance_fixture)),
  1,
  'a member can see only their own monthly obligation'
);
select is(
  (select count(*)::integer from public.get_finance_month_dues((select due_month from finance_fixture))),
  1,
  'monthly dues summary respects the requesting member row policy'
);
select ok(
  (select dues_total = 500.00::numeric
      and dues_paid = 125.50::numeric
      and dues_outstanding = 374.50::numeric
      and dues_count = 1
   from public.get_finance_period_summary((select due_month from finance_fixture))),
  'a member sees only their own monthly obligation and paid balance'
);
select is(
  (select count(*)::integer from public.finance_entries
    where member_id = (select other_member_id from finance_fixture)),
  0,
  'a member cannot read another member contribution'
);
select ok(
  (select income_total = 375.50::numeric
      and expense_total = 0::numeric
      and balance = 375.50::numeric
   from public.get_finance_period_summary((select due_month from finance_fixture))),
  'period totals are scoped to the requesting member rather than the club ledger'
);

do $$
begin
  begin
    insert into public.finance_entries (direction, category, amount, occurred_on, description)
    values ('income', 'donation', 100, current_date, 'Escritura directa');
    raise exception 'Authenticated member inserted directly into the ledger';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;
select ok(true, 'members cannot bypass finance functions with direct table inserts');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', (select coordinator_id::text from finance_fixture), true);
do $$
begin
  begin
    perform public.create_finance_monthly_dues(
      (select due_month from finance_fixture), 500.00
    );
    raise exception 'Coordinator generated monthly dues';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;
select ok(true, 'coordinators cannot create financial obligations');

reset role;
select set_config('request.jwt.claim.sub', (select manager_id::text from finance_fixture), true);
select ok(
  (select count(*) = 2 and bool_and(log.actor_id = (select manager_id from finance_fixture)
      and log.before_data is null and log.after_data is not null)
   from public.audit_log as log
   where log.table_name = 'finance_entries'
     and log.record_id in (select entry_id::text from finance_created_entries)),
  'financial income entries keep detailed actor-attributed audit snapshots'
);
select ok(
  exists (
    select 1 from public.audit_log as log
    where log.table_name = 'finance_monthly_dues'
      and log.actor_id = (select manager_id from finance_fixture)
      and (log.after_data->>'amount_due')::numeric = 500.00
  ),
  'generated monthly obligations are recorded in the admin audit trail'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', (select manager_id::text from finance_fixture), true);
select is(
  public.create_finance_monthly_dues(
    (select due_month from finance_fixture), 500.00
  ),
  0,
  'running the monthly generator again does not duplicate existing dues'
);

select * from finish();
rollback;
