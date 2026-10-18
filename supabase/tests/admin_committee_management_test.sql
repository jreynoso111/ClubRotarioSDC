begin;
select set_config('request.jwt.claims', jsonb_build_object('aal', 'aal2', 'amr', jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint)))::text, true); -- privileged fixtures act with a recent second factor (privileged_mfa_test.sql covers its absence)
select plan(13);

select ok(
  to_regprocedure('public.create_committee_with_members(text,text,text,uuid[],text[])') is not null,
  'committee creation function exists'
);

select ok(
  not (
    select procedure.prosecdef
    from pg_proc as procedure
    where procedure.oid = to_regprocedure('public.create_committee_with_members(text,text,text,uuid[],text[])')
  ),
  'committee creation function runs as the invoking user'
);

select ok(
  has_function_privilege('authenticated', 'public.create_committee_with_members(text,text,text,uuid[],text[])', 'EXECUTE'),
  'authenticated clients can call the function and rely on its admin and RLS checks'
);

select ok(
  not has_function_privilege('anon', 'public.create_committee_with_members(text,text,text,uuid[],text[])', 'EXECUTE'),
  'anonymous clients cannot call the committee creation function'
);

select ok(
  (
    select with_check ilike '%admin%'
      and with_check ilike '%club_manager%'
      and with_check not ilike '%coordinator%'
    from pg_policies
    where schemaname = 'public' and tablename = 'committees'
      and policyname = 'committees_management_insert'
  ),
  'only club managers and admins can create committees'
);

select ok(
  (
    select qual ilike '%admin%'
      and qual ilike '%club_manager%'
      and qual not ilike '%coordinator%'
      and with_check ilike '%admin%'
      and with_check ilike '%club_manager%'
      and with_check not ilike '%coordinator%'
    from pg_policies
    where schemaname = 'public' and tablename = 'committees'
      and policyname = 'committees_management_update'
  ),
  'only club managers and admins can edit, finish or reopen committees'
);

select ok(
  (
    select with_check ilike '%admin%'
      and with_check ilike '%club_manager%'
      and with_check ilike '%is_active%'
      and with_check not ilike '%coordinator%'
    from pg_policies
    where schemaname = 'public' and tablename = 'committee_members'
      and policyname = 'committee_members_management_insert'
  ),
  'only club managers and admins can add committee members'
);

select ok(
  (
    select qual ilike '%admin%'
      and qual ilike '%club_manager%'
      and qual ilike '%is_active%'
      and qual not ilike '%coordinator%'
      and with_check ilike '%admin%'
      and with_check ilike '%club_manager%'
      and with_check ilike '%is_active%'
      and with_check not ilike '%coordinator%'
    from pg_policies
    where schemaname = 'public' and tablename = 'committee_members'
      and policyname = 'committee_members_management_update'
  ),
  'only club managers and admins can change committee member roles'
);

select ok(
  (
    select qual ilike '%admin%'
      and qual ilike '%club_manager%'
      and qual ilike '%is_active%'
      and qual not ilike '%coordinator%'
    from pg_policies
    where schemaname = 'public' and tablename = 'committee_members'
      and policyname = 'committee_members_management_delete'
  ),
  'only club managers and admins can remove committee members'
);

select ok(
  (
    select qual ilike '%admin%' and qual ilike '%is_active%'
    from pg_policies
    where schemaname = 'public' and tablename = 'committees'
      and policyname = 'committees_select_member'
  ),
  'admins can view completed committees while members only see active committees'
);

select is(
  (select count(*)::integer from pg_policies where schemaname = 'public' and tablename = 'committees' and cmd = 'DELETE'),
  0,
  'committees cannot be deleted; completion preserves the record'
);

select ok(
  not has_table_privilege('authenticated', 'public.committees', 'DELETE'),
  'authenticated clients do not have table-level committee delete permission'
);

select ok(
  (select qual ilike '%is_active%' from pg_policies
   where schemaname = 'public' and tablename = 'committee_members'
     and policyname = 'committee_members_management_delete'),
  'completed committee rosters cannot be removed through direct table access'
);

select * from finish();
rollback;
