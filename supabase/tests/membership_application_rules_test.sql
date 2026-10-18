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

-- act_as models a session with a recent second factor; act_without_mfa models a password-only session.
create function pg_temp.act_as(_user uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', _user::text, true),
         set_config('request.jwt.claims', jsonb_build_object('sub', _user, 'session_id', _user, 'role', 'authenticated', 'aal', 'aal2',
           'amr', jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint)))::text, true);
$$;
create function pg_temp.act_without_mfa(_user uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', _user::text, true),
         set_config('request.jwt.claims', jsonb_build_object('sub', _user, 'session_id', _user, 'role', 'authenticated', 'aal', 'aal1')::text, true);
$$;
create function pg_temp.notices(_user uuid, _title text) returns integer language sql security definer as $$
  select count(*)::integer from public.notifications where user_id = _user and title = _title;
$$;
create temporary table app_ids (label text primary key, id uuid);
grant all on app_ids to authenticated;
grant execute on function pg_temp.notices(uuid, text) to authenticated;

select plan(57);

-- Structure behind the contract.
select ok(
  exists (select 1 from pg_constraint
    where conrelid = 'public.membership_applications'::regclass
      and conname = 'membership_applications_decline_reason'),
  'declining an application requires a stored reason'
);
select ok(
  exists (select 1 from pg_policies
    where schemaname = 'public' and tablename = 'membership_applications'
      and policyname = 'membership_applications_read_management' and cmd = 'SELECT')
  and not exists (select 1 from pg_policies
    where schemaname = 'public' and tablename = 'membership_applications'
      and policyname in ('membership_applications_read_active_members', 'membership_applications_review_management')),
  'only management reads applications directly and reviews go through the function'
);
select ok(
  not has_table_privilege('authenticated', 'public.membership_applications', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.membership_applications', 'status', 'UPDATE'),
  'signed-in users cannot update applications directly'
);
select ok(
  not has_function_privilege('anon', 'public.review_membership_application(uuid,text,text,timestamptz)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.list_membership_applications(text,text,integer,integer)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.review_membership_application(uuid,text,text,timestamptz)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.list_membership_applications(text,text,integer,integer)', 'EXECUTE'),
  'the review and list functions are for signed-in users only'
);
select ok(
  (select bool_and(relrowsecurity) from pg_class
   where oid in ('public.membership_application_notes'::regclass, 'public.membership_application_history'::regclass)),
  'notes and history are protected by RLS'
);

-- Fixtures: two signed-in accounts (one manager, one ordinary member) and two applications.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values
  ('b1111111-1111-4111-8111-111111111111', gen_random_uuid(), 'authenticated', 'authenticated', 'app-manager@example.invalid', '', now(), '{}', '{}'),
  ('b2222222-2222-4222-8222-222222222222', gen_random_uuid(), 'authenticated', 'authenticated', 'app-member@example.invalid', '', now(), '{}', '{}');
update public.memberships set membership_status = 'active', membership_role = case user_id
    when 'b1111111-1111-4111-8111-111111111111' then 'club_manager' else 'member' end
where user_id in ('b1111111-1111-4111-8111-111111111111', 'b2222222-2222-4222-8222-222222222222');

select public.submit_membership_application('Ana Prueba Rivera', 'ana-prueba@example.invalid', '+1 809 555 0101', 'Abogada',
  'Quiero servir a mi comunidad y participar en los proyectos de la Ciudad Colonial.', 'Amiga del club', true);
insert into app_ids select 'ana', id from public.membership_applications where email = 'ana-prueba@example.invalid';
select public.submit_membership_application('Bruno Ejemplo Méndez', 'bruno%demo@example.invalid', '+1 809 555 0202', null,
  'Me gustaría colaborar con las actividades sociales y con la revista del club.', null, true);
insert into app_ids select 'bruno', id from public.membership_applications where email = 'bruno%demo@example.invalid';

-- Submission: history and notices.
select is(
  (select count(*)::integer from public.membership_application_history
   where application_id = (select id from app_ids where label = 'ana') and from_status is null and to_status = 'new'),
  1, 'a submitted application starts its status history');
select is(pg_temp.notices('b1111111-1111-4111-8111-111111111111', 'Nueva solicitud de membresía'), 2,
  'management is notified about each new application');
select is(pg_temp.notices('b2222222-2222-4222-8222-222222222222', 'Nueva solicitud de membresía'), 0,
  'ordinary members are not notified about applications');
select ok(
  exists (select 1 from public.notifications
    where user_id = 'b1111111-1111-4111-8111-111111111111'
      and title = 'Nueva solicitud de membresía'
      and body = 'Ana Prueba Rivera quiere unirse al club.'
      and href = '/plataforma?tab=solicitudes'),
  'the notice names the applicant and opens the requests tab'
);

-- Constraints hold even for direct writes.
select throws_ok($$update public.membership_applications set status = 'contacted', reviewed_by = null
  where email = 'bruno%demo@example.invalid'$$, '23514', null, 'a reviewed application keeps its reviewer');
select throws_ok($$update public.membership_applications set status = 'declined',
  reviewed_by = 'b1111111-1111-4111-8111-111111111111', decision_reason = null
  where email = 'bruno%demo@example.invalid'$$, '23514', null, 'declining always keeps a reason');

-- Ordinary member: no direct reads, list without contact details, no review.
set local role authenticated;
select pg_temp.act_as('b2222222-2222-4222-8222-222222222222');
select is((select count(*)::integer from public.membership_applications), 0,
  'members cannot read applications directly');
select ok(
  exists (select 1 from public.list_membership_applications(_limit => 50) where id = (select id from app_ids where label = 'ana'))
  and exists (select 1 from public.list_membership_applications(_limit => 50) where id = (select id from app_ids where label = 'bruno')),
  'members see the applications list'
);
select ok(
  (select count(*) = 2 and bool_and(email is null and phone is null and motivation is null
     and referral_source is null and decision_reason is null and invited_at is null and account_created = false)
   from public.list_membership_applications(_limit => 50) where id in (select id from app_ids)),
  'members do not receive contact details, motivations or review reasons'
);
select ok(
  exists (select 1 from public.list_membership_applications(_search => 'rivera', _limit => 50) where id = (select id from app_ids where label = 'ana'))
  and not exists (select 1 from public.list_membership_applications(_search => 'rivera', _limit => 50) where id = (select id from app_ids where label = 'bruno')),
  'members can search applicants by name'
);
select ok(
  not exists (select 1 from public.list_membership_applications(_search => 'ana-prueba@', _limit => 50) where id = (select id from app_ids where label = 'ana')),
  'members cannot search by email'
);
select throws_ok($$select public.review_membership_application((select id from app_ids where label = 'ana'),
  'contacted', null, now())$$, '42501', null, 'members cannot review applications');
select throws_ok($$insert into public.membership_application_notes (application_id, body)
  values ((select id from app_ids where label = 'ana'), 'Intento de miembro')$$, '42501', null,
  'members cannot write internal notes');

-- Manager with a recent second factor: list, filters, search and review.
select pg_temp.act_as('b1111111-1111-4111-8111-111111111111');
select is((select email from public.list_membership_applications(_limit => 50) where id = (select id from app_ids where label = 'ana')),
  'ana-prueba@example.invalid', 'management sees contact details in the list');
select is((select total_count::integer from public.list_membership_applications(_limit => 1) limit 1),
  (select count(*)::integer from public.membership_applications), 'the list reports how many applications match');
select ok(
  (select count(*) = 2 from public.list_membership_applications(_status => 'new', _limit => 50) where id in (select id from app_ids)),
  'the status filter finds both applications that are still new'
);
select ok(
  exists (select 1 from public.list_membership_applications(_search => 'rivera', _limit => 50) where id = (select id from app_ids where label = 'ana'))
  and not exists (select 1 from public.list_membership_applications(_search => 'rivera', _limit => 50) where id = (select id from app_ids where label = 'bruno')),
  'the search matches the applicant name'
);
select ok(
  exists (select 1 from public.list_membership_applications(_search => '%', _limit => 50) where id = (select id from app_ids where label = 'bruno'))
  and not exists (select 1 from public.list_membership_applications(_search => '%', _limit => 50) where id = (select id from app_ids where label = 'ana')),
  'a percent sign in the search is literal'
);
select ok(
  not exists (select 1 from public.list_membership_applications(_search => '_', _limit => 50) where id in (select id from app_ids)),
  'an underscore in the search is literal'
);
select is((select count(*)::integer from public.list_membership_applications(_limit => 0)), 1,
  'the page size is kept between 1 and 50');

-- The database trigger refreshes updated_at; within one transaction now() is fixed, so the
-- stale checks use an explicit old timestamp instead of trying to advance the clock.
select is(
  public.review_membership_application((select id from app_ids where label = 'ana'), 'contacted', null,
    (select updated_at from public.membership_applications where id = (select id from app_ids where label = 'ana'))),
  (select updated_at from public.membership_applications where id = (select id from app_ids where label = 'ana')),
  'a review returns the stored updated_at'
);
select is((select status from public.membership_applications where id = (select id from app_ids where label = 'ana')),
  'contacted', 'a review moves the application to contacted');
select is((select reviewed_by from public.membership_applications where id = (select id from app_ids where label = 'ana')),
  'b1111111-1111-4111-8111-111111111111'::uuid, 'the reviewer is the signed-in manager');
select ok(
  exists (select 1 from public.list_membership_applications(_status => 'new', _limit => 50) where id = (select id from app_ids where label = 'bruno'))
  and not exists (select 1 from public.list_membership_applications(_status => 'new', _limit => 50) where id = (select id from app_ids where label = 'ana')),
  'the status filter follows the review'
);
select throws_ok($$select public.review_membership_application((select id from app_ids where label = 'ana'),
  'contacted', null, now() - interval '1 day')$$, 'P0409', null, 'a stale review is rejected');
select throws_ok($$select public.review_membership_application('00000000-0000-4000-8000-000000000000',
  'contacted', null, now())$$, 'P0002', null, 'an unknown application is reported as not found');
select throws_ok($$select public.review_membership_application((select id from app_ids where label = 'ana'),
  'archived', null, now())$$, '22023', null, 'unknown statuses are rejected');
select throws_ok($$select public.review_membership_application((select id from app_ids where label = 'ana'),
  'declined', '   ', (select updated_at from public.membership_applications where id = (select id from app_ids where label = 'ana')))$$,
  '22023', null, 'declining without a reason is rejected');
select lives_ok($$select public.review_membership_application((select id from app_ids where label = 'ana'),
  'declined', 'Motivo claro para el comité', (select updated_at from public.membership_applications where id = (select id from app_ids where label = 'ana')))$$,
  'declining with a reason is accepted');
select is((select decision_reason from public.membership_applications where id = (select id from app_ids where label = 'ana')),
  'Motivo claro para el comité', 'the decline reason is stored');
select is((select count(*)::integer from public.membership_application_history
  where application_id = (select id from app_ids where label = 'ana') and from_status = 'contacted'
    and to_status = 'declined' and reason = 'Motivo claro para el comité'), 1,
  'the history records the decline with its reason');
select lives_ok($$select public.review_membership_application((select id from app_ids where label = 'ana'),
  'new', null, (select updated_at from public.membership_applications where id = (select id from app_ids where label = 'ana')))$$,
  'an application can be reopened as new');
select is((select decision_reason from public.membership_applications where id = (select id from app_ids where label = 'ana')),
  null::text, 'reopening clears the decision reason');
select lives_ok($$select public.review_membership_application((select id from app_ids where label = 'ana'),
  'invited', null, (select updated_at from public.membership_applications where id = (select id from app_ids where label = 'ana')))$$,
  'an applicant can be invited');
select ok(
  (select invited_at is not null from public.membership_applications where id = (select id from app_ids where label = 'ana')),
  'inviting records when the invitation was made'
);

-- Writes go through the function only.
select throws_ok($$update public.membership_applications set status = 'contacted'
  where email = 'bruno%demo@example.invalid'$$, '42501', null,
  'management changes status only through the review function');
select throws_ok($$insert into public.membership_application_history (application_id, to_status)
  values ((select id from app_ids where label = 'bruno'), 'contacted')$$, '42501', null,
  'the status history cannot be written directly');

-- Internal notes: management writes and reads them; the author is always the signed-in manager.
select lives_ok($$insert into public.membership_application_notes (application_id, body)
  values ((select id from app_ids where label = 'ana'), 'Llamé al solicitante y confirmó su interés.')$$,
  'management records an internal note');
select is((select count(*)::integer from public.membership_application_notes
  where application_id = (select id from app_ids where label = 'ana')), 1,
  'management reads the internal notes');
select is((select author_id from public.membership_application_notes
  where application_id = (select id from app_ids where label = 'ana') limit 1),
  'b1111111-1111-4111-8111-111111111111'::uuid, 'the note records its author');
select throws_ok($$insert into public.membership_application_notes (application_id, body, author_id)
  values ((select id from app_ids where label = 'ana'), 'Autor falso', 'b2222222-2222-4222-8222-222222222222')$$,
  '42501', null, 'the client cannot choose the note author');

-- Manager without a recent second factor: behaves as an ordinary member.
select pg_temp.act_without_mfa('b1111111-1111-4111-8111-111111111111');
select is((select count(*)::integer from public.membership_applications), 0,
  'without a recent second factor a manager cannot read the table directly');
select is((select email from public.list_membership_applications(_limit => 50) where id = (select id from app_ids where label = 'ana')),
  null::text, 'without a recent second factor a manager sees no contact details');
select throws_ok($$select public.review_membership_application((select id from app_ids where label = 'ana'),
  'contacted', null, now())$$, '42501', null, 'without a recent second factor a manager cannot review');
select pg_temp.act_as('b1111111-1111-4111-8111-111111111111');

-- The invited applicant creates an account: the sign-up is linked and management is told.
reset role;
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values ('b3333333-3333-4333-8333-333333333333', gen_random_uuid(), 'authenticated', 'authenticated',
  'ana-prueba@example.invalid', '', now(), '{}', '{}');
select is((select invited_user_id from public.membership_applications where id = (select id from app_ids where label = 'ana')),
  'b3333333-3333-4333-8333-333333333333'::uuid, 'the invited applicant account is linked to the application');
select is(pg_temp.notices('b1111111-1111-4111-8111-111111111111', 'Solicitante con cuenta creada'), 1,
  'management is notified when the invited applicant creates an account');
select is(pg_temp.notices('b2222222-2222-4222-8222-222222222222', 'Solicitante con cuenta creada'), 0,
  'ordinary members are not notified about applicant accounts');
select lives_ok($$insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values ('b4444444-4444-4444-8444-444444444444', gen_random_uuid(), 'authenticated', 'authenticated',
  'sin-solicitud@example.invalid', '', now(), '{}', '{}')$$,
  'a sign-up without an invitation still succeeds');

set local role authenticated;
select pg_temp.act_as('b1111111-1111-4111-8111-111111111111');
select is((select account_created from public.list_membership_applications(_limit => 50) where id = (select id from app_ids where label = 'ana')),
  true, 'management sees that the invited applicant created an account');
select is((select count(*)::integer from public.membership_application_history
  where application_id = (select id from app_ids where label = 'ana')), 5,
  'the history holds the five status changes and nothing from the account link');

-- Ordinary member again: no notes and no history.
select pg_temp.act_as('b2222222-2222-4222-8222-222222222222');
select is((select count(*)::integer from public.membership_application_notes), 0,
  'members cannot read internal notes');
select is((select count(*)::integer from public.membership_application_history), 0,
  'members cannot read the status history');

reset role;
select * from finish();
rollback;
