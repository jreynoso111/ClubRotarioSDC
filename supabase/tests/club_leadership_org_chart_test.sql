begin;
select plan(40);

create temporary table leadership_fixture (
  admin_id uuid, member_id uuid, manager_id uuid, suspended_id uuid,
  historical_year integer, copy_year integer, current_year integer,
  term_id uuid, copy_id uuid, current_id uuid, president_id uuid, child_id uuid,
  live_position_id uuid, position_time timestamptz, joined_at timestamptz, approved_at timestamptz
);
insert into leadership_fixture(admin_id, member_id, manager_id, suspended_id, historical_year, copy_year, current_year)
select gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  (select min(year) from generate_series(1970, 1990) year where not exists (select 1 from public.club_leadership_terms where start_year = year)),
  (select max(year) from generate_series(2180, 2200) year where not exists (select 1 from public.club_leadership_terms where start_year = year)),
  extract(year from now() at time zone 'America/Santo_Domingo')::integer - case when extract(month from now() at time zone 'America/Santo_Domingo') < 7 then 1 else 0 end;
insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select fixture_id, gen_random_uuid(), 'authenticated', 'authenticated', fixture_id::text || '@leadership-test.example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
from (select admin_id fixture_id from leadership_fixture union all select member_id from leadership_fixture
  union all select manager_id from leadership_fixture union all select suspended_id from leadership_fixture) fixtures;
update public.memberships set membership_status = 'active', membership_role = case
  when user_id = (select admin_id from leadership_fixture) then 'admin'
  when user_id = (select manager_id from leadership_fixture) then 'club_manager' else 'member' end
where user_id in (select admin_id from leadership_fixture union all select member_id from leadership_fixture union all select manager_id from leadership_fixture);
update public.memberships set membership_status = 'suspended', membership_role = 'admin' where user_id = (select suspended_id from leadership_fixture);
update public.profiles set display_name = 'Miembro de verificación' where id = (select member_id from leadership_fixture);
update leadership_fixture set joined_at = membership.joined_at, approved_at = membership.approved_at from public.memberships membership where membership.user_id = leadership_fixture.member_id;
grant select, update on leadership_fixture to authenticated;

select ok(not has_table_privilege('anon', 'public.club_leadership_positions', 'SELECT'), 'anonymous users cannot read the internal org chart');
select ok(not has_table_privilege('authenticated', 'public.club_leadership_positions', 'DELETE'), 'positions are retired rather than deleted by clients');
select ok(not has_function_privilege('anon', 'public.save_club_leadership_position(uuid,uuid,text,text,uuid,uuid,integer,boolean,text,boolean,timestamptz)', 'EXECUTE'), 'anonymous users cannot call assignment RPC');
select ok(not (select prosecdef from pg_proc where oid = to_regprocedure('public.save_club_leadership_position(uuid,uuid,text,text,uuid,uuid,integer,boolean,text,boolean,timestamptz)')), 'assignment RPC respects the invoking user and row policies');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', (select admin_id::text from leadership_fixture), true);
select lives_ok($$update leadership_fixture set term_id = public.create_club_leadership_term(historical_year, 'Verificación temporal', null)$$, 'active admin creates a Rotary period');
select is((select count(*)::integer from public.club_leadership_positions where term_id = (select term_id from leadership_fixture)), 7, 'starting structure includes seven editable cargos');
select ok((select bool_and(member_id is null and access_role = 'member') from public.club_leadership_positions where term_id = (select term_id from leadership_fixture)), 'all cargos start vacant with normal member access');
select is((select public.create_club_leadership_term(historical_year, 'Repeated creation', null) from leadership_fixture), (select term_id from leadership_fixture), 'repeated period creation preserves its existing structure');
update leadership_fixture set president_id = (select id from public.club_leadership_positions where term_id = (select term_id from leadership_fixture) and title = 'Presidencia'),
  child_id = (select id from public.club_leadership_positions where term_id = (select term_id from leadership_fixture) and title = 'Vicepresidencia');
select lives_ok($$update public.club_leadership_positions set member_id = (select member_id from leadership_fixture), access_role = 'admin' where id = (select president_id from leadership_fixture)$$, 'administrator assigns presidency and configures its access');
select is((select membership_role from public.memberships where user_id = (select member_id from leadership_fixture)), 'member', 'a configured administrator cargo does not automatically change account privileges');
select is((select member_name_snapshot from public.club_leadership_positions where id = (select president_id from leadership_fixture)), 'Miembro de verificación', 'assignment records the member name for historical periods');
select throws_ok($$update public.club_leadership_positions set parent_id = (select child_id from leadership_fixture) where id = (select president_id from leadership_fixture)$$, '22023', null, 'hierarchy rejects cycles');
select throws_ok($$update public.club_leadership_positions set is_active = false where id = (select president_id from leadership_fixture)$$, '22023', null, 'parent cargos cannot be retired while their active children depend on them');
select throws_ok($$insert into public.club_leadership_positions(term_id,title) select term_id,'  presidencia  ' from leadership_fixture$$, '23505', null, 'active cargo names cannot be duplicated with whitespace or casing');
select throws_ok($$update public.club_leadership_positions set member_id = (select suspended_id from leadership_fixture) where id = (select child_id from leadership_fixture)$$, '22023', null, 'suspended profiles cannot receive new assignments');
select lives_ok($$update leadership_fixture set copy_id = public.create_club_leadership_term(copy_year, 'Copia temporal', term_id)$$, 'next period can copy a configured structure');
select ok((select count(*) = 7 and count(*) filter (where parent_id is not null) = 6 and bool_and(member_id is null) from public.club_leadership_positions where term_id = (select copy_id from leadership_fixture)), 'copy retains hierarchy while clearing every member assignment');
select is((select access_role from public.club_leadership_positions where term_id = (select copy_id from leadership_fixture) and title = 'Presidencia'), 'admin', 'copy retains configured access without granting it to anybody');
select throws_ok($$update public.club_leadership_positions set parent_id = (select president_id from leadership_fixture) where term_id = (select copy_id from leadership_fixture) and title = 'Presidencia'$$, '22023', null, 'parent cargos must belong to the same Rotary period');
select lives_ok($$update public.club_leadership_terms set is_locked = true where id = (select term_id from leadership_fixture)$$, 'administrator closes editing of a historical period');
select throws_ok($$update public.club_leadership_positions set title = 'Presidente' where id = (select president_id from leadership_fixture)$$, '22023', null, 'closed periods reject changes to their cargos');
update public.club_leadership_terms set is_locked = false where id = (select term_id from leadership_fixture);

select lives_ok($$update leadership_fixture set current_id = public.create_club_leadership_term(current_year, '', null)$$, 'current Rotary period is available for access assignment');
select lives_ok($$update leadership_fixture set live_position_id = public.save_club_leadership_position(null, current_id, 'Prueba-' || admin_id::text, '', null, member_id, 99, true, 'coordinator', false, null)$$, 'current cargo assignment still preserves access when apply is false');
select is((select membership_role from public.memberships where user_id = (select member_id from leadership_fixture)), 'member', 'current-year title alone also preserves membership role');
update leadership_fixture set position_time = (select updated_at from public.club_leadership_positions where id = (select live_position_id from leadership_fixture));
select lives_ok($$select public.save_club_leadership_position(live_position_id, current_id, 'Prueba-' || admin_id::text, '', null, member_id, 99, true, 'coordinator', true, position_time) from leadership_fixture$$, 'explicit apply updates the cargo and member access atomically');
select is((select membership_role from public.memberships where user_id = (select member_id from leadership_fixture)), 'coordinator', 'account receives exactly the access level chosen by administrator');
select ok((select membership.joined_at is not distinct from fixture.joined_at and membership.approved_at is not distinct from fixture.approved_at from public.memberships membership join leadership_fixture fixture on fixture.member_id = membership.user_id), 'changing access retains entry and approval dates');
select throws_ok($$select public.save_club_leadership_position(live_position_id, current_id, 'Prueba-' || admin_id::text, '', null, member_id, 99, true, 'admin', true, position_time) from leadership_fixture$$, '40001', null, 'stale editing cannot overwrite a cargo or broaden member access');
select is((select membership_role from public.memberships where user_id = (select member_id from leadership_fixture)), 'coordinator', 'failed stale save does not partially change membership');
select throws_ok($$select public.save_club_leadership_position(null, current_id, 'Auto-cambio', '', null, admin_id, 0, true, 'member', true, null) from leadership_fixture$$, '42501', null, 'administrator cannot demote their own account');
select throws_ok($$select public.save_club_leadership_position(null, term_id, 'Acceso histórico', '', null, member_id, 0, true, 'admin', true, null) from leadership_fixture$$, '22023', null, 'historical periods cannot change current account access');
select throws_ok($$select public.save_club_leadership_position(null, copy_id, 'Acceso futuro', '', null, member_id, 0, true, 'admin', true, null) from leadership_fixture$$, '22023', null, 'future periods cannot change current account access');
select ok(exists(select 1 from public.audit_log where table_name = 'club_leadership_positions' and record_id = (select live_position_id::text from leadership_fixture) and actor_id = (select admin_id from leadership_fixture) and after_data->>'access_role' = 'coordinator'), 'cargo changes retain administrator attribution in audit');
select ok(exists(select 1 from public.audit_log where table_name = 'memberships' and record_id = (select member_id::text from leadership_fixture) and actor_id = (select admin_id from leadership_fixture) and before_data->>'membership_role' = 'member' and after_data->>'membership_role' = 'coordinator'), 'explicit access application produces before and after membership audit');

select set_config('request.jwt.claim.sub', (select manager_id::text from leadership_fixture), true);
select throws_ok($$select public.create_club_leadership_term(2101,'No autorizado',null)$$, '42501', null, 'club managers cannot define periods');
select throws_ok($$select public.save_club_leadership_position(null,current_id,'No autorizado','',null,member_id,0,true,'admin',true,null) from leadership_fixture$$, '42501', null, 'club managers cannot configure or apply cargo privileges');
select set_config('request.jwt.claim.sub', (select member_id::text from leadership_fixture), true);
select is((select count(*)::integer from public.club_leadership_positions where term_id = (select term_id from leadership_fixture)), 7, 'active members can consult a historical org chart');
with updated as (update public.club_leadership_positions set access_role = 'admin' where id = (select president_id from leadership_fixture) returning id)
select is(count(*)::integer, 0, 'non-admin direct updates are rejected by row policies') from updated;
select set_config('request.jwt.claim.sub', (select suspended_id::text from leadership_fixture), true);
select is((select count(*)::integer from public.club_leadership_terms), 0, 'suspended accounts cannot read organizational periods');
select throws_ok($$select public.create_club_leadership_term(2101,'No autorizado',null)$$, '42501', null, 'suspended administrators cannot create a period');
reset role;

select * from finish();
rollback;
