begin;
select plan(25);
select ok((select relrowsecurity from pg_class where oid='public.account_password_setups'::regclass),'setup data uses RLS');
select ok(not has_table_privilege('authenticated','public.account_password_setups','SELECT'),'members cannot read password digests');
select ok(not has_table_privilege('authenticated','public.account_password_setups','UPDATE'),'members cannot clear the setup gate');
select ok(has_table_privilege('service_role','public.account_password_setups','UPDATE'),'server provisioning can complete setup');
select ok(not has_function_privilege('anon','public.account_password_state()','EXECUTE'),'anonymous cannot query setup state');

insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values
('ea111111-1111-4111-8111-111111111111','password-setup@example.invalid','{"require_password_change":true}','{"require_password_change":false}'),
('ea222222-2222-4222-8222-222222222222','ordinary-account@example.invalid','{}','{}');
update public.memberships set membership_status='active' where user_id in
('ea111111-1111-4111-8111-111111111111','ea222222-2222-4222-8222-222222222222');
insert into public.account_password_setups(user_id,created_by,password_salt,initial_password_digest)
values('ea111111-1111-4111-8111-111111111111','ea222222-2222-4222-8222-222222222222',repeat('a',32),repeat('b',128));
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
('ea333333-3333-4333-8333-333333333333','ea111111-1111-4111-8111-111111111111',now()-interval '1 minute',now(),'aal1');
set local role authenticated;
select set_config('request.jwt.claim.sub','ea222222-2222-4222-8222-222222222222',true);
select is(public.account_password_state(),'ready','existing accounts do not need an initial change');
select ok(private.is_active_member(),'existing member access is unchanged');
select set_config('request.jwt.claim.sub','ea111111-1111-4111-8111-111111111111',true);
select set_config('request.jwt.claims','{"sub":"ea111111-1111-4111-8111-111111111111","session_id":"ea333333-3333-4333-8333-333333333333"}',true);
select is(public.account_password_state(),'required','admin-created account must change its password');
select ok(not private.is_active_member(),'approved membership cannot bypass first password');
select ok(not private.has_any_role(array['member']),'role checks also deny temporary-password sessions');
select is((select count(*)::integer from public.profiles),0,'direct profile reads are blocked before setup');
select is((select count(*)::integer from public.memberships),0,'direct membership reads are blocked before setup');
select throws_ok($$select * from public.account_password_setups$$,'42501',null,'user cannot read setup secrets');
with changed as (update public.profiles set display_name='Bypass' where id='ea111111-1111-4111-8111-111111111111' returning id)
select is((select count(*)::integer from changed),0,'ownership update cannot bypass the gate');
select throws_ok($$insert into public.proposals(title,summary) values('Bypass attempt','A proposal before the mandatory password change.')$$,'42501',null,'business writes remain blocked');
select is((select count(*)::integer from public.list_club_member_profiles()),0,'directory RPC does not bypass the gate');
reset role;
update auth.users set raw_app_meta_data='{"require_password_change":false}' where id='ea111111-1111-4111-8111-111111111111';
set local role authenticated;
select is(public.account_password_state(),'required','clearing metadata alone cannot complete setup');
reset role;
update public.account_password_setups set completed_at=clock_timestamp(),password_salt=null,initial_password_digest=null
where user_id='ea111111-1111-4111-8111-111111111111';
set local role authenticated;
select is(public.account_password_state(),'sign_in_again','JWT from temporary-password login stays blocked after change');
select ok(not private.is_active_member(),'old session cannot acquire member privileges after setup');
reset role;
insert into auth.sessions(id,user_id,created_at,updated_at,aal) values
('ea444444-4444-4444-8444-444444444444','ea111111-1111-4111-8111-111111111111',clock_timestamp(),clock_timestamp(),'aal1');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"ea111111-1111-4111-8111-111111111111","session_id":"ea444444-4444-4444-8444-444444444444"}',true);
select is(public.account_password_state(),'ready','a fresh session after completion can enter');
select ok(private.is_active_member(),'new password login restores normal member access');
reset role;
select ok((select password_salt is null and initial_password_digest is null from public.account_password_setups
where user_id='ea111111-1111-4111-8111-111111111111'),'temporary digest is removed after completion');
select ok(not exists(select 1 from public.audit_log where table_name='account_password_setups' and (
  before_data ? 'password_salt' or before_data ? 'initial_password_digest'
  or after_data ? 'password_salt' or after_data ? 'initial_password_digest')),'audit never contains salt or password digests');
select ok((select count(*) from pg_policy where polname='account_initial_password_gate') >=
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relrowsecurity and c.relkind='r'),
  'restrictive gate covers every current public RLS table and storage');
select throws_ok($$insert into public.account_password_setups(user_id,created_by) values
('ea222222-2222-4222-8222-222222222222','ea111111-1111-4111-8111-111111111111')$$,'23514',null,'incomplete digest records are rejected');
select * from finish();
rollback;
