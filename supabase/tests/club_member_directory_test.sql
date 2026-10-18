begin;
select plan(12);
select ok(not has_function_privilege('anon','public.list_club_member_profiles()','EXECUTE'),'anonymous cannot query member directory');
select ok(has_function_privilege('authenticated','public.list_club_member_profiles()','EXECUTE'),'signed-in clients can query directory');
select is((select proargnames from pg_proc where oid='public.list_club_member_profiles()'::regprocedure),
  array['id','display_name','bio']::text[],'directory exposes only public profile fields');
insert into auth.users(id,email,raw_user_meta_data) values
('e9111111-1111-4111-8111-111111111111','directory-admin@example.invalid','{}'),
('e9222222-2222-4222-8222-222222222222','directory-member@example.invalid','{}'),
('e9333333-3333-4333-8333-333333333333','directory-manager@example.invalid','{}'),
('e9444444-4444-4444-8444-444444444444','directory-suspended@example.invalid','{}'),
('e9555555-5555-4555-8555-555555555555','directory-pending@example.invalid','{}');
update public.memberships set membership_role = case user_id
  when 'e9111111-1111-4111-8111-111111111111' then 'admin'
  when 'e9333333-3333-4333-8333-333333333333' then 'club_manager' else 'member' end,
  membership_status = case user_id
  when 'e9444444-4444-4444-8444-444444444444' then 'suspended'
  when 'e9555555-5555-4555-8555-555555555555' then 'pending' else 'active' end
where user_id in ('e9111111-1111-4111-8111-111111111111','e9222222-2222-4222-8222-222222222222',
  'e9333333-3333-4333-8333-333333333333','e9444444-4444-4444-8444-444444444444','e9555555-5555-4555-8555-555555555555');
set local role authenticated;
select set_config('request.jwt.claim.sub','e9222222-2222-4222-8222-222222222222',true);
select is((select count(*)::integer from public.list_club_member_profiles() where id in (
  'e9111111-1111-4111-8111-111111111111','e9222222-2222-4222-8222-222222222222','e9333333-3333-4333-8333-333333333333',
  'e9444444-4444-4444-8444-444444444444','e9555555-5555-4555-8555-555555555555')),2,'directory counts members separately from admin accounts');
select ok(not exists(select 1 from public.list_club_member_profiles() where id='e9111111-1111-4111-8111-111111111111'),'admin never appears as member');
select ok(not exists(select 1 from public.list_club_member_profiles() where id='e9444444-4444-4444-8444-444444444444'),'suspended account absent from active directory');
select ok(not exists(select 1 from public.list_club_member_profiles() where id='e9555555-5555-4555-8555-555555555555'),'pending account absent from active directory');
select ok(exists(select 1 from public.list_club_member_profiles() where id='e9333333-3333-4333-8333-333333333333'),'ordinary member can see another club member');
select set_config('request.jwt.claim.sub','e9111111-1111-4111-8111-111111111111',true);
select ok(not exists(select 1 from public.list_club_member_profiles() where id='e9111111-1111-4111-8111-111111111111'),'admin does not appear in own member directory');
select set_config('request.jwt.claim.sub','e9444444-4444-4444-8444-444444444444',true);
select is((select count(*)::integer from public.list_club_member_profiles()),0,'suspended callers cannot read directory');
select set_config('request.jwt.claim.sub','e9555555-5555-4555-8555-555555555555',true);
select is((select count(*)::integer from public.list_club_member_profiles()),0,'pending callers cannot read directory');
reset role;
select ok(exists(select 1 from public.memberships where user_id='e9111111-1111-4111-8111-111111111111'
  and membership_role='admin' and membership_status='active'),'administrative access record remains intact');
select * from finish();
rollback;
