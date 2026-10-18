begin;

-- Synthetic sessions belong only to users inserted by this rolled-back suite.
create function pg_temp.club_fixture_session() returns trigger language plpgsql as $$
begin
  insert into auth.sessions(id, user_id, created_at, updated_at, aal)
  values(new.id, new.id, now(), now(), 'aal2');
  return new;
end; $$;
create trigger club_fixture_session after insert on auth.users
for each row execute function pg_temp.club_fixture_session();

select plan(22);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values
  ('e1111111-1111-4111-8111-111111111111', gen_random_uuid(), 'authenticated', 'authenticated', 'fin-manager@example.invalid', '', now(), '{}', '{}'),
  ('e2222222-2222-4222-8222-222222222222', gen_random_uuid(), 'authenticated', 'authenticated', 'fin-member@example.invalid', '', now(), '{}', '{}'),
  ('e3333333-3333-4333-8333-333333333333', gen_random_uuid(), 'authenticated', 'authenticated', 'fin-other@example.invalid', '', now(), '{}', '{}'),
  ('e4444444-4444-4444-8444-444444444444', gen_random_uuid(), 'authenticated', 'authenticated', 'fin-lead@example.invalid', '', now(), '{}', '{}'),
  ('e5555555-5555-4555-8555-555555555555', gen_random_uuid(), 'authenticated', 'authenticated', 'fin-coordinator@example.invalid', '', now(), '{}', '{}');
update public.memberships set membership_status = 'active', membership_role = case user_id
    when 'e1111111-1111-4111-8111-111111111111' then 'club_manager'
    when 'e5555555-5555-4555-8555-555555555555' then 'coordinator' else 'member' end
where user_id::text like 'e_______-____-4___-8___-____________';
insert into public.activities (id, title, slug, lead_id)
values ('e9999999-9999-4999-8999-999999999999', 'Jornada con presupuesto', 'jornada-con-presupuesto-qa', 'e4444444-4444-4444-8444-444444444444');

create function pg_temp.act_as(_user uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', _user::text, true),
         set_config('request.jwt.claims', jsonb_build_object('sub', _user, 'session_id', _user, 'role', 'authenticated', 'aal', 'aal2',
           'amr', jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint)))::text, true);
$$;
create function pg_temp.notices(_user uuid, _title text) returns integer language sql security definer as $$
  select count(*)::integer from public.notifications where user_id = _user and title = _title;
$$;
create function pg_temp.this_month() returns date language sql as $$
  select date_trunc('month', (now() at time zone 'America/Santo_Domingo'))::date;
$$;
create function pg_temp.today() returns date language sql as $$
  select (now() at time zone 'America/Santo_Domingo')::date;
$$;
create temporary table fin_ids (label text primary key, id uuid);
grant all on fin_ids to authenticated;
grant execute on function pg_temp.notices(uuid, text) to authenticated;

set local role authenticated;

-- 2. A due notifies the member; a payment gets a receipt number and a notice.
select pg_temp.act_as('e1111111-1111-4111-8111-111111111111');
select public.create_finance_member_dues(pg_temp.this_month(), 1500, array['e2222222-2222-4222-8222-222222222222', 'e3333333-3333-4333-8333-333333333333']::uuid[]);
select is(pg_temp.notices('e2222222-2222-4222-8222-222222222222', 'Cuota asignada'), 1, 'the member is told about a new due');
insert into fin_ids select 'due', id from public.finance_monthly_dues where member_id = 'e2222222-2222-4222-8222-222222222222';
insert into fin_ids values ('payment', public.record_finance_monthly_payment((select id from fin_ids where label = 'due'), 500, pg_temp.today(), 'cash', null));
select ok((select receipt_number is not null from public.finance_entries where id = (select id from fin_ids where label = 'payment')), 'an income gets a receipt number');
select is(pg_temp.notices('e2222222-2222-4222-8222-222222222222', 'Pago registrado'), 1, 'the member is told about the payment');

select pg_temp.act_as('e2222222-2222-4222-8222-222222222222');
select is((select count(*)::integer from public.finance_entries), 1, 'the member reads their own payment');
select throws_ok($$select public.void_finance_entry((select id from fin_ids where label = 'payment'), 'Intento de miembro')$$,
  '42501', null, 'members cannot void entries');

-- 1. Voiding needs a reason and stops counting.
select pg_temp.act_as('e1111111-1111-4111-8111-111111111111');
select throws_ok($$select public.void_finance_entry((select id from fin_ids where label = 'payment'), 'mal')$$,
  '22023', null, 'voiding requires a real reason');
select lives_ok($$select public.void_finance_entry((select id from fin_ids where label = 'payment'), 'Se registró a la persona equivocada')$$,
  'management voids an entry with a reason');
select is(pg_temp.notices('e2222222-2222-4222-8222-222222222222', 'Movimiento anulado'), 1, 'the member is told about the voided payment');
select is((select amount_paid from public.get_finance_month_dues(pg_temp.this_month()) where member_id = 'e2222222-2222-4222-8222-222222222222'), 0::numeric,
  'a voided payment no longer counts toward the due');
select lives_ok($$select public.record_finance_monthly_payment((select id from fin_ids where label = 'due'), 1500, pg_temp.today(), 'bank_transfer', 'TRF-1')$$,
  'the full due can be paid again after voiding');
select throws_ok($$select public.void_finance_entry((select id from fin_ids where label = 'payment'), 'Segunda anulación')$$,
  '22023', null, 'an entry cannot be voided twice');
select is((select income_total from public.get_finance_period_summary(pg_temp.this_month())), 1500::numeric, 'period totals exclude voided entries');

-- 4. Year summary and cumulative balance.
select public.create_finance_entry('income', 'donation', 2000, pg_temp.today(), 'Donación de un aliado', null, 'Aliado SRL', null, 'cash', null);
select public.create_finance_entry('expense', 'activity_expense', 300, pg_temp.today(), 'Guantes para la jornada', null, 'Ferretería', 'e9999999-9999-4999-8999-999999999999', 'cash', null);
select is((select cumulative from public.get_finance_year_summary(extract(year from pg_temp.today())::integer) where month_start = pg_temp.this_month()),
  3200::numeric, 'the cumulative balance adds every valid entry');
select pg_temp.act_as('e2222222-2222-4222-8222-222222222222');
select throws_ok($$select * from public.get_finance_year_summary(2026)$$, '42501', null, 'the club summary is for management');

-- 7. Activity finances for the lead and coordination only.
select pg_temp.act_as('e4444444-4444-4444-8444-444444444444');
select is((select count(*)::integer from public.get_activity_finance('e9999999-9999-4999-8999-999999999999')), 1, 'the activity lead sees its finances');
select pg_temp.act_as('e5555555-5555-4555-8555-555555555555');
select is((select count(*)::integer from public.get_activity_finance('e9999999-9999-4999-8999-999999999999')), 1, 'coordination sees activity finances');
select pg_temp.act_as('e3333333-3333-4333-8333-333333333333');
select throws_ok($$select * from public.get_activity_finance('e9999999-9999-4999-8999-999999999999')$$, '42501', null, 'other members cannot');

-- 8. Attachments must belong to their entry.
select pg_temp.act_as('e1111111-1111-4111-8111-111111111111');
select throws_ok($$select public.set_finance_entry_attachment((select id from fin_ids where label = 'payment'), 'otra-entrada/recibo.pdf')$$,
  '22023', null, 'an attachment path must start with its entry');
select lives_ok($$select public.set_finance_entry_attachment((select id from fin_ids where label = 'payment'), (select id from fin_ids where label = 'payment')::text || '/recibo.pdf')$$,
  'management attaches a receipt to the entry');

-- 3. Reminders go once, only to unpaid dues.
reset role;
select is(private.send_dues_reminders(), 1, 'one reminder for the unpaid due');
select is(private.send_dues_reminders(), 0, 'reminders are sent once');
select is(pg_temp.notices('e3333333-3333-4333-8333-333333333333', 'Cuota pendiente'), 1, 'the member with a balance is reminded');

select * from finish();
rollback;
