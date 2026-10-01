begin;
select plan(29);

-- Every identifier is private to this rollback-only suite. The historical month
-- keeps sample movements out of the current club period. Preserve any existing
-- historical totals as a baseline rather than assuming the ledger is empty.
create temporary table finance_selection_fixture (
  manager_id uuid not null,
  member_id uuid not null,
  other_member_id uuid not null,
  suspended_id uuid not null,
  activity_id uuid not null,
  due_month date not null
);
insert into finance_selection_fixture values (
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), date '2001-01-01'
);

create temporary table finance_selection_baseline as
select
  coalesce(sum(amount) filter (where direction = 'income'), 0) as income_total,
  coalesce(sum(amount) filter (where direction = 'expense'), 0) as expense_total,
  count(*) as entry_count
from public.finance_entries
where occurred_on >= date '2001-01-01' and occurred_on < date '2001-02-01';

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select fixture_id, gen_random_uuid(), 'authenticated', 'authenticated',
  fixture_id::text || '@club-finance-selection.test', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
from (
  select manager_id as fixture_id from finance_selection_fixture
  union all select member_id from finance_selection_fixture
  union all select other_member_id from finance_selection_fixture
  union all select suspended_id from finance_selection_fixture
) as fixtures;

update public.profiles
set display_name = case id
  when (select manager_id from finance_selection_fixture) then 'Gestión seleccionada de prueba'
  when (select member_id from finance_selection_fixture) then 'Socio seleccionado Uno'
  when (select other_member_id from finance_selection_fixture) then 'Socio seleccionado Dos'
  else 'Socio suspendido de prueba'
end
where id in (
  (select manager_id from finance_selection_fixture),
  (select member_id from finance_selection_fixture),
  (select other_member_id from finance_selection_fixture),
  (select suspended_id from finance_selection_fixture)
);

update public.memberships
set membership_role = case
      when user_id = (select manager_id from finance_selection_fixture) then 'club_manager'
      else 'member'
    end,
    membership_status = case
      when user_id = (select suspended_id from finance_selection_fixture) then 'suspended'
      else 'active'
    end
where user_id in (
  (select manager_id from finance_selection_fixture),
  (select member_id from finance_selection_fixture),
  (select other_member_id from finance_selection_fixture),
  (select suspended_id from finance_selection_fixture)
);

insert into public.activities (id, title, slug, activity_status)
select activity_id, 'Actividad contable seleccionada de prueba',
  'finance-selection-' || activity_id::text, 'planned'
from finance_selection_fixture;

create temporary table finance_selection_entries (
  entry_kind text primary key,
  entry_id uuid not null
);
grant select on finance_selection_fixture, finance_selection_baseline to authenticated, anon;
grant select, insert on finance_selection_entries to authenticated;

select ok(
  has_function_privilege('authenticated', 'public.create_finance_member_dues(date,numeric,uuid[])', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.get_finance_scope_totals(date,uuid,uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.create_finance_member_dues(date,numeric,uuid[])', 'EXECUTE')
    and not has_function_privilege('anon', 'public.get_finance_scope_totals(date,uuid,uuid)', 'EXECUTE'),
  'selected obligations and scoped totals are callable only by authenticated clients'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', (select manager_id::text from finance_selection_fixture), true);

select is(
  public.create_finance_member_dues(
    (select due_month from finance_selection_fixture), 350.00,
    array[(select member_id from finance_selection_fixture)]
  ),
  1,
  'selecting one member creates exactly one obligation'
);
select ok(
  exists (
    select 1 from public.finance_monthly_dues
    where member_id = (select member_id from finance_selection_fixture)
      and due_month = (select due_month from finance_selection_fixture)
      and amount_due = 350.00
      and member_name_snapshot = 'Socio seleccionado Uno'
      and created_by = (select manager_id from finance_selection_fixture)
  ),
  'the selected obligation keeps its own member, amount, name, period and manager'
);
select is(
  (select count(*)::integer from public.finance_monthly_dues
    where due_month = (select due_month from finance_selection_fixture)
      and member_id in (
        (select manager_id from finance_selection_fixture),
        (select other_member_id from finance_selection_fixture)
      )),
  0,
  'unselected active members receive no obligation'
);
select is(
  public.create_finance_member_dues(
    (select due_month from finance_selection_fixture), 500.00,
    array[(select other_member_id from finance_selection_fixture)]
  ),
  1,
  'another member can receive a different amount for the same month'
);
select ok(
  (select count(*) = 2
      and sum(amount_due) = 850.00
      and bool_and(case
        when member_id = (select member_id from finance_selection_fixture) then amount_due = 350.00
        else amount_due = 500.00
      end)
   from public.finance_monthly_dues
   where due_month = (select due_month from finance_selection_fixture)
     and member_id in (
       (select member_id from finance_selection_fixture),
       (select other_member_id from finance_selection_fixture)
     )),
  'different selected members retain independent monthly balances'
);
select is(
  public.create_finance_member_dues(
    (select due_month from finance_selection_fixture), 999.00,
    array[(select member_id from finance_selection_fixture)]
  ),
  0,
  'repeating a selected member and month is idempotent even with a different amount'
);
select is(
  (select amount_due from public.finance_monthly_dues
    where member_id = (select member_id from finance_selection_fixture)
      and due_month = (select due_month from finance_selection_fixture)),
  350.00::numeric,
  'an idempotent retry does not overwrite the original amount'
);
select throws_ok(
  format('select public.create_finance_member_dues(%L::date,350.00,array[%L::uuid])',
    (select due_month from finance_selection_fixture),
    (select suspended_id from finance_selection_fixture)),
  '22023', 'Invalid members, period or amount.',
  'a suspended member cannot be selected for a new obligation'
);
select throws_ok(
  $$select public.create_finance_member_dues(date '2001-01-01',350.00,array[]::uuid[])$$,
  '22023', 'Invalid members, period or amount.',
  'an empty member selection cannot become a club-wide obligation'
);
select throws_ok(
  format('select public.create_finance_member_dues(%L::date,350.00,array[%L::uuid,%L::uuid])',
    (select due_month from finance_selection_fixture),
    (select manager_id from finance_selection_fixture),
    (select suspended_id from finance_selection_fixture)),
  '22023', 'Invalid members, period or amount.',
  'a mixed active and suspended selection is rejected atomically'
);
select is(
  (select count(*)::integer from public.finance_monthly_dues
    where due_month = (select due_month from finance_selection_fixture)
      and member_id in (
        (select manager_id from finance_selection_fixture),
        (select member_id from finance_selection_fixture),
        (select other_member_id from finance_selection_fixture),
        (select suspended_id from finance_selection_fixture)
      )),
  2,
  'rejected selections leave only the two explicitly created obligations'
);

insert into finance_selection_entries (entry_kind, entry_id)
select 'member_activity_income', public.create_finance_entry(
  'income', 'activity_contribution', 120.00, date '2001-01-10', 'Aporte del socio Uno',
  (select member_id from finance_selection_fixture), null,
  (select activity_id from finance_selection_fixture), 'cash', 'SEL-IN-1'
);
insert into finance_selection_entries (entry_kind, entry_id)
select 'other_activity_income', public.create_finance_entry(
  'income', 'activity_contribution', 230.00, date '2001-01-10', 'Aporte del socio Dos',
  (select other_member_id from finance_selection_fixture), null,
  (select activity_id from finance_selection_fixture), 'bank_transfer', 'SEL-IN-2'
);
insert into finance_selection_entries (entry_kind, entry_id)
select 'member_donation', public.create_finance_entry(
  'income', 'donation', 50.00, date '2001-01-11', 'Donación del socio Uno',
  (select member_id from finance_selection_fixture), null, null, 'cash', 'SEL-IN-3'
);
insert into finance_selection_entries (entry_kind, entry_id)
select 'member_activity_expense', public.create_finance_entry(
  'expense', 'activity_expense', 30.00, date '2001-01-11', 'Gasto de actividad del socio Uno',
  (select member_id from finance_selection_fixture), null,
  (select activity_id from finance_selection_fixture), 'cash', 'SEL-OUT-1'
);
insert into finance_selection_entries (entry_kind, entry_id)
select 'other_operating_expense', public.create_finance_entry(
  'expense', 'operating_expense', 40.00, date '2001-01-11', 'Gasto operativo del socio Dos',
  (select other_member_id from finance_selection_fixture), null, null, 'cash', 'SEL-OUT-2'
);
insert into finance_selection_entries (entry_kind, entry_id)
select 'monthly_payment', public.record_finance_monthly_payment(
  (select id from public.finance_monthly_dues
    where member_id = (select member_id from finance_selection_fixture)
      and due_month = (select due_month from finance_selection_fixture)),
  100.00, date '2001-01-12', 'cash', 'SEL-PAYMENT-1'
);
insert into finance_selection_entries (entry_kind, entry_id)
select 'following_month', public.create_finance_entry(
  'income', 'donation', 999.00, date '2001-02-01', 'Ingreso del periodo siguiente',
  (select member_id from finance_selection_fixture), null, null, 'cash', 'SEL-NEXT'
);
insert into finance_selection_entries (entry_kind, entry_id)
select 'previous_month', public.create_finance_entry(
  'income', 'donation', 888.00, date '2000-12-31', 'Ingreso del periodo anterior',
  (select member_id from finance_selection_fixture), null, null, 'cash', 'SEL-PREVIOUS'
);

select ok(
  (select totals.income_total = baseline.income_total + 500.00
      and totals.expense_total = baseline.expense_total + 70.00
      and totals.entry_count = baseline.entry_count + 6
   from public.get_finance_scope_totals((select due_month from finance_selection_fixture)) totals
   cross join finance_selection_baseline baseline),
  'club totals include all income and expenses for the month and exclude adjacent periods'
);
select ok(
  (select income_total = 270.00 and expense_total = 30.00 and entry_count = 4
   from public.get_finance_scope_totals(
     (select due_month from finance_selection_fixture),
     (select member_id from finance_selection_fixture), null)),
  'a manager can scope both income and expenses to one member'
);
select ok(
  (select income_total = 350.00 and expense_total = 30.00 and entry_count = 3
   from public.get_finance_scope_totals(
     (select due_month from finance_selection_fixture), null,
     (select activity_id from finance_selection_fixture))),
  'an activity total combines contributions from different members and its expenses'
);
select ok(
  (select income_total = 120.00 and expense_total = 30.00 and entry_count = 2
   from public.get_finance_scope_totals(
     (select due_month from finance_selection_fixture),
     (select member_id from finance_selection_fixture),
     (select activity_id from finance_selection_fixture))),
  'combined member and activity filters apply as an intersection'
);
select ok(
  (select income_total = 230.00 and expense_total = 40.00 and entry_count = 2
   from public.get_finance_scope_totals(
     (select due_month from finance_selection_fixture),
     (select other_member_id from finance_selection_fixture), null)),
  'another member scope keeps a separate income and expense balance'
);
select ok(
  (select income_total = 999.00 and expense_total = 0 and entry_count = 1
   from public.get_finance_scope_totals(
     date '2001-02-01', (select member_id from finance_selection_fixture), null)),
  'the next month starts inclusively while the previous month ends exclusively'
);

select set_config('request.jwt.claim.sub', (select member_id::text from finance_selection_fixture), true);
select throws_ok(
  format('select public.create_finance_member_dues(%L::date,350.00,array[%L::uuid])',
    (select due_month from finance_selection_fixture),
    (select member_id from finance_selection_fixture)),
  '42501', 'Active club management membership required.',
  'an ordinary member cannot create their own financial obligation'
);
select ok(
  (select count(*) = 1 and min(amount_due) = 350.00
   from public.finance_monthly_dues
   where due_month = (select due_month from finance_selection_fixture)),
  'RLS lets a member read only their own obligation'
);
select ok(
  (select count(*) = 3 and bool_and(member_id = (select member_id from finance_selection_fixture))
      and bool_and(direction = 'income')
   from public.finance_entries
   where occurred_on >= date '2001-01-01' and occurred_on < date '2001-02-01'),
  'RLS hides another member records and club expenses, including expenses linked to the reader'
);
select ok(
  (select income_total = 270.00 and expense_total = 0 and entry_count = 3
   from public.get_finance_scope_totals((select due_month from finance_selection_fixture))),
  'an unfiltered totals call still respects the member own-income policy'
);
select ok(
  (select income_total = 120.00 and expense_total = 0 and entry_count = 1
   from public.get_finance_scope_totals(
     (select due_month from finance_selection_fixture), null,
     (select activity_id from finance_selection_fixture))),
  'activity totals cannot reveal other members contributions to the same activity'
);
select ok(
  (select income_total = 0 and expense_total = 0 and entry_count = 0
   from public.get_finance_scope_totals(
     (select due_month from finance_selection_fixture),
     (select other_member_id from finance_selection_fixture), null)),
  'passing another member identifier cannot bypass row-level security'
);

select set_config('request.jwt.claim.sub', (select suspended_id::text from finance_selection_fixture), true);
select throws_ok(
  format('select public.create_finance_member_dues(%L::date,350.00,array[%L::uuid])',
    (select due_month from finance_selection_fixture),
    (select member_id from finance_selection_fixture)),
  '42501', 'Active club management membership required.',
  'a suspended membership cannot create selected obligations'
);
select ok(
  (select income_total = 0 and expense_total = 0 and entry_count = 0
   from public.get_finance_scope_totals((select due_month from finance_selection_fixture))),
  'a suspended membership receives no financial totals'
);
select is(
  (select count(*)::integer from public.finance_monthly_dues),
  0,
  'a suspended membership cannot read monthly obligations'
);

reset role;
set local role anon;
select set_config('request.jwt.claim.role', 'anon', true);
select set_config('request.jwt.claim.sub', '', true);
select throws_ok(
  $$select public.create_finance_member_dues(date '2001-01-01',350.00,array[]::uuid[])$$,
  '42501', null,
  'an anonymous caller cannot execute selected obligation creation'
);
select throws_ok(
  $$select * from public.get_finance_scope_totals(date '2001-01-01')$$,
  '42501', null,
  'an anonymous caller cannot execute scoped financial totals'
);

reset role;
select * from finish();
rollback;
