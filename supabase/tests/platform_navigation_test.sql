begin;
select plan(24);

select ok((select relrowsecurity from pg_class where oid = 'public.platform_navigation'::regclass), 'navigation uses RLS');
select is((select count(*)::integer from public.platform_navigation), 1, 'one shared settings row');
select ok(not has_table_privilege('anon', 'public.platform_navigation', 'SELECT'), 'anonymous cannot read navigation');
select ok(not has_table_privilege('authenticated', 'public.platform_navigation', 'INSERT'), 'clients cannot create settings rows');
select ok(not has_table_privilege('authenticated', 'public.platform_navigation', 'DELETE'), 'clients cannot delete settings');
select ok(not has_column_privilege('authenticated', 'public.platform_navigation', 'revision', 'UPDATE'), 'clients cannot forge revision');
select ok(exists(select 1 from pg_trigger where tgrelid = 'public.platform_navigation'::regclass and tgname = 'zz_club_audit'), 'changes are audited');

insert into auth.users(id, email, raw_user_meta_data) values
('e8111111-1111-4111-8111-111111111111', 'navigation-admin@example.invalid', '{"display_name":"Navigation Admin"}'),
('e8222222-2222-4222-8222-222222222222', 'navigation-member@example.invalid', '{}'),
('e8333333-3333-4333-8333-333333333333', 'navigation-manager@example.invalid', '{}'),
('e8444444-4444-4444-8444-444444444444', 'navigation-suspended@example.invalid', '{}'),
('e8555555-5555-4555-8555-555555555555', 'navigation-pending@example.invalid', '{}');
update public.memberships set membership_role = case user_id
  when 'e8111111-1111-4111-8111-111111111111' then 'admin'
  when 'e8333333-3333-4333-8333-333333333333' then 'club_manager'
  else 'member' end,
  membership_status = case user_id
  when 'e8444444-4444-4444-8444-444444444444' then 'suspended'
  when 'e8555555-5555-4555-8555-555555555555' then 'pending'
  else 'active' end
where user_id in ('e8111111-1111-4111-8111-111111111111', 'e8222222-2222-4222-8222-222222222222',
  'e8333333-3333-4333-8333-333333333333', 'e8444444-4444-4444-8444-444444444444', 'e8555555-5555-4555-8555-555555555555');
insert into auth.sessions(id,user_id,created_at,updated_at,aal)
select id,id,now(),now(),'aal2' from auth.users where id in (
  'e8111111-1111-4111-8111-111111111111', 'e8222222-2222-4222-8222-222222222222', 'e8333333-3333-4333-8333-333333333333',
  'e8444444-4444-4444-8444-444444444444', 'e8555555-5555-4555-8555-555555555555');
create function pg_temp.navigation_actor(_user uuid, _mfa boolean default true) returns void language sql as $$
  select set_config('request.jwt.claim.sub', _user::text, true),
    set_config('request.jwt.claims', jsonb_build_object('sub', _user, 'session_id', _user, 'role', 'authenticated',
      'aal', case when _mfa then 'aal2' else 'aal1' end,
      'amr', case when _mfa then jsonb_build_array(jsonb_build_object('method','totp','timestamp',extract(epoch from now())::bigint)) else '[]'::jsonb end)::text, true);
$$;
set local role authenticated;
select pg_temp.navigation_actor('e8222222-2222-4222-8222-222222222222');
select is((select count(*)::integer from public.platform_navigation),1,'active member reads shared menu');
with changed as (update public.platform_navigation set item_order = item_order returning id)
select is((select count(*)::integer from changed),0,'ordinary member cannot update');
select pg_temp.navigation_actor('e8333333-3333-4333-8333-333333333333');
with changed as (update public.platform_navigation set item_order = item_order returning id)
select is((select count(*)::integer from changed),0,'club manager cannot reorder');
select pg_temp.navigation_actor('e8444444-4444-4444-8444-444444444444');
select is((select count(*)::integer from public.platform_navigation),0,'suspended membership cannot read');
select pg_temp.navigation_actor('e8555555-5555-4555-8555-555555555555');
select is((select count(*)::integer from public.platform_navigation),0,'pending membership cannot read');
select pg_temp.navigation_actor('e8111111-1111-4111-8111-111111111111',false);
with changed as (update public.platform_navigation set item_order = item_order returning id)
select is((select count(*)::integer from changed),0,'administrator without MFA cannot update');
select pg_temp.navigation_actor('e8111111-1111-4111-8111-111111111111');
select throws_ok($$update public.platform_navigation set item_order = array['resumen']$$,'23514',null,'cannot omit pages');
select throws_ok($$update public.platform_navigation set item_order = array_fill('resumen'::text,array[11])$$,'23514',null,'cannot duplicate pages');
select throws_ok($$update public.platform_navigation set item_order[1] = 'mensajes'$$,'23514',null,'messages cannot enter sidebar');
select throws_ok($$update public.platform_navigation set item_order[1] = null$$,'23514',null,'null pages rejected');
select throws_ok($$update public.platform_navigation set revision = 99$$,'42501',null,'revision is server controlled');
with changed as (
  update public.platform_navigation set item_order = array['revista','resumen','propuestas','agenda','actividades','finanzas','solicitudes','organizacion','fotografias','auditoria','diagnostico']
  where id and revision = 0 returning id
) select is((select count(*)::integer from changed),1,'admin saves complete order with current revision');
select is((select revision from public.platform_navigation),1,'saved revision advances');
with changed as (update public.platform_navigation set item_order = item_order where revision = 0 returning id)
select is((select count(*)::integer from changed),0,'stale administrator cannot overwrite newer order');
select pg_temp.navigation_actor('e8222222-2222-4222-8222-222222222222');
select is((select item_order[1] from public.platform_navigation),'revista','another member sees the same new order');
reset role;
select is((select updated_by from public.platform_navigation),'e8111111-1111-4111-8111-111111111111'::uuid,'actor recorded');
select ok(exists(select 1 from public.audit_log where table_name = 'platform_navigation'),'shared menu change captured in audit');
select * from finish();
rollback;
