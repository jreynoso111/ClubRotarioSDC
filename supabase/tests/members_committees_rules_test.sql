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
-- Notifications are private to their recipient, so the count is read with the owner's rights.
create function pg_temp.notice_count(_user uuid, _title text, _body_part text default null)
returns integer language sql security definer set search_path = '' as $$
  select count(*)::integer from public.notifications
  where user_id = _user and title = _title
    and (_body_part is null or position(_body_part in body) > 0);
$$;

select plan(86);

-- Structure behind the contract.
select ok(
  (select prosecdef from pg_proc where oid = to_regprocedure('public.update_member_access(uuid,text,text,text,text,timestamptz)')),
  'membership access changes run as a definer function with their own checks'
);
select ok(not has_table_privilege('authenticated', 'public.memberships', 'UPDATE'),
  'signed-in users cannot update memberships directly');
select ok(not has_column_privilege('authenticated', 'public.memberships', 'notes', 'SELECT'),
  'members cannot read the private notes column');
select ok(has_column_privilege('authenticated', 'public.memberships', 'membership_role', 'SELECT')
  and has_column_privilege('authenticated', 'public.memberships', 'membership_status', 'SELECT'),
  'members can still read their own role and status columns');
select ok(
  not has_function_privilege('anon', 'public.update_member_access(uuid,text,text,text,text,timestamptz)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.list_pending_members()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.reject_pending_member(uuid,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_membership_notes(uuid[])', 'EXECUTE'),
  'anonymous clients cannot call the membership functions'
);
select ok(has_function_privilege('authenticated', 'public.update_member_access(uuid,text,text,text,text,timestamptz)', 'EXECUTE'),
  'signed-in users can call the access function');
select ok(
  (select prosecdef from pg_proc where oid = to_regprocedure('public.save_club_leadership_position(uuid,uuid,text,text,uuid,uuid,integer,boolean,text,boolean,timestamptz)')),
  'the organisation RPC writes memberships as a definer after its own administrator check'
);
select ok(exists (select 1 from pg_trigger
    where tgrelid = 'public.memberships'::regclass and tgname = 'memberships_guard_last_admin' and not tgisinternal),
  'the last administrator is protected by a trigger');
select ok(to_regprocedure('private.membership_link_invited_account()') is null
  and not exists (select 1 from pg_trigger where tgname = 'memberships_link_invited_account'),
  'the link that ran on membership insert is removed');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'committee_members_one_chair_idx'),
  'a committee has at most one chair');
select ok(
  (select bool_and(relrowsecurity) from pg_class
   where oid in ('public.membership_access_history'::regclass, 'public.membership_rejections'::regclass)),
  'access history and rejections are protected by RLS'
);
select ok(
  (select count(*) = 2 from pg_trigger
   where tgname = 'zz_club_audit' and not tgisinternal
     and tgrelid in ('public.membership_access_history'::regclass, 'public.membership_rejections'::regclass)),
  'access history and rejections enter the club audit trail'
);

-- Fixtures. A and B are administrators, M and M2 club managers, O and S members, T waits for approval.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('e1111111-1111-4111-8111-111111111111', gen_random_uuid(), 'authenticated', 'authenticated', 'rules-admin-a@example.invalid', '', now(), '{}', '{"display_name":"Administradora A"}', now() - interval '60 days', now()),
  ('e2222222-2222-4222-8222-222222222222', gen_random_uuid(), 'authenticated', 'authenticated', 'rules-admin-b@example.invalid', '', now(), '{}', '{"display_name":"Administrador B"}', now() - interval '60 days', now()),
  ('e3333333-3333-4333-8333-333333333333', gen_random_uuid(), 'authenticated', 'authenticated', 'rules-manager@example.invalid', '', now(), '{}', '{"display_name":"Gestora de reglas"}', now() - interval '60 days', now()),
  ('e4444444-4444-4444-8444-444444444444', gen_random_uuid(), 'authenticated', 'authenticated', 'rules-manager-2@example.invalid', '', now(), '{}', '{"display_name":"Gestor secundario"}', now() - interval '60 days', now()),
  ('e5555555-5555-4555-8555-555555555555', gen_random_uuid(), 'authenticated', 'authenticated', 'rules-member@example.invalid', '', now(), '{}', '{"display_name":"Miembro de reglas"}', now() - interval '50 days', now()),
  ('e6666666-6666-4666-8666-666666666666', gen_random_uuid(), 'authenticated', 'authenticated', 'rules-ordinary@example.invalid', '', now(), '{}', '{"display_name":"Miembro ordinario"}', now() - interval '50 days', now()),
  ('e8888888-8888-4888-8888-888888888888', gen_random_uuid(), 'authenticated', 'authenticated', 'rules-seats@example.invalid', '', now(), '{}', '{"display_name":"Integrante con cargos"}', now() - interval '50 days', now());
update public.memberships set membership_status = 'active', membership_role = case user_id
    when 'e1111111-1111-4111-8111-111111111111' then 'admin'
    when 'e2222222-2222-4222-8222-222222222222' then 'admin'
    when 'e3333333-3333-4333-8333-333333333333' then 'club_manager'
    when 'e4444444-4444-4444-8444-444444444444' then 'club_manager'
    else 'member' end
where user_id in ('e1111111-1111-4111-8111-111111111111', 'e2222222-2222-4222-8222-222222222222',
  'e3333333-3333-4333-8333-333333333333', 'e4444444-4444-4444-8444-444444444444',
  'e6666666-6666-4666-8666-666666666666', 'e8888888-8888-4888-8888-888888888888');
update public.memberships set membership_status = 'suspended'
where membership_role = 'admin' and membership_status = 'active'
  and user_id not in ('e1111111-1111-4111-8111-111111111111', 'e2222222-2222-4222-8222-222222222222');

-- Club management: no peer changes, no self changes, no privilege escalation.
set local role authenticated;
select pg_temp.act_as('e3333333-3333-4333-8333-333333333333');

select throws_ok($$select public.update_member_access('e4444444-4444-4444-8444-444444444444', 'club_manager', 'active', null, null,
  (select updated_at from public.memberships where user_id = 'e4444444-4444-4444-8444-444444444444'))$$,
  '42501', null, 'club management cannot change another club management account');
select throws_ok($$select public.update_member_access('e5555555-5555-4555-8555-555555555555', 'club_manager', 'pending', null, null, null)$$,
  '42501', null, 'club management cannot grant club management');
select throws_ok($$select public.update_member_access('e5555555-5555-4555-8555-555555555555', 'admin', 'pending', null, null, null)$$,
  '42501', null, 'club management cannot grant administration');
select throws_ok($$select public.update_member_access('e3333333-3333-4333-8333-333333333333', 'club_manager', 'active', null, null, null)$$,
  '42501', null, 'nobody changes their own access through the function');
select throws_ok($$select public.update_member_access('e5555555-5555-4555-8555-555555555555', 'owner', 'pending', null, null, null)$$,
  '22023', 'Invalid member access.', 'an unknown role is rejected');
select throws_ok($$select public.update_member_access('e5555555-5555-4555-8555-555555555555', 'member', 'deleted', null, null, null)$$,
  '22023', 'Invalid member access.', 'an unknown status is rejected');
select throws_ok($$select public.update_member_access('e5555555-5555-4555-8555-555555555555', 'member', 'pending', repeat('n', 4001), null, null)$$,
  '22023', 'Member notes are too long.', 'member notes are limited to 4000 characters');
select throws_ok($$select public.update_member_access('e5555555-5555-4555-8555-555555555555', 'member', 'active', null, null, now() - interval '1 day')$$,
  'P0409', 'stale_member', 'a stale member record is rejected');
select throws_ok($$select public.update_member_access('e5555555-5555-4555-8555-555555555555', 'member', 'active', null, 'no',
  (select updated_at from public.memberships where user_id = 'e5555555-5555-4555-8555-555555555555'))$$,
  '22023', 'reason_length', 'a reason that is given must have 5 to 500 characters');

-- Approval of a pending member keeps the first activation dates and returns the previous state.
select ok(
  (select previous_status = 'pending' and email = 'rules-member@example.invalid' and display_name = 'Miembro de reglas'
   from public.update_member_access('e5555555-5555-4555-8555-555555555555', 'member', 'active', 'Nota inicial de ingreso', null,
     (select updated_at from public.memberships where user_id = 'e5555555-5555-4555-8555-555555555555'))),
  'approving a pending member returns the previous state, the email and the name'
);
select ok(
  (select joined_at is not null and approved_at is not null and approved_by = 'e3333333-3333-4333-8333-333333333333'
   from public.memberships where user_id = 'e5555555-5555-4555-8555-555555555555'),
  'first activation records the entry date, the approval date and the approver'
);
select is(
  (select notes from public.get_membership_notes(array['e5555555-5555-4555-8555-555555555555']::uuid[])),
  'Nota inicial de ingreso', 'management reads the notes through the function'
);
select lives_ok($$select * from public.update_member_access('e5555555-5555-4555-8555-555555555555', 'member', 'active', '   ', null,
  (select updated_at from public.memberships where user_id = 'e5555555-5555-4555-8555-555555555555'))$$,
  'a blank note is accepted as an update of the notes');
select is(
  (select notes from public.get_membership_notes(array['e5555555-5555-4555-8555-555555555555']::uuid[])),
  null::text, 'a blank note is stored as empty'
);

-- Role change: reason required, recorded in history, and announced to the member.
select lives_ok($$select * from public.update_member_access('e5555555-5555-4555-8555-555555555555', 'coordinator', 'active', null,
  'Asignación de coordinación del comité',
  (select updated_at from public.memberships where user_id = 'e5555555-5555-4555-8555-555555555555'))$$,
  'a role change is accepted with a reason');
select ok(
  exists (select 1 from public.membership_access_history
    where user_id = 'e5555555-5555-4555-8555-555555555555'
      and from_role = 'member' and to_role = 'coordinator'
      and from_status = 'active' and to_status = 'active'
      and reason = 'Asignación de coordinación del comité'
      and actor_id = 'e3333333-3333-4333-8333-333333333333'),
  'the access history keeps the reason and the signed-in actor'
);
select is(
  pg_temp.notice_count('e5555555-5555-4555-8555-555555555555', 'Tu rol en el club cambió', 'Ahora tu rol es Coordinación.'), 1,
  'the member is told the new role'
);

-- Suspension: reason required; with a reason it is recorded and the member is told why.
select throws_ok($$select public.update_member_access('e5555555-5555-4555-8555-555555555555', 'coordinator', 'suspended', null, null,
  (select updated_at from public.memberships where user_id = 'e5555555-5555-4555-8555-555555555555'))$$,
  '22023', 'reason_required', 'a suspension without a reason is rejected');
select throws_ok($$select public.update_member_access('e5555555-5555-4555-8555-555555555555', 'coordinator', 'suspended', null, 'no',
  (select updated_at from public.memberships where user_id = 'e5555555-5555-4555-8555-555555555555'))$$,
  '22023', 'reason_required', 'a suspension with a reason shorter than 5 characters is rejected');
select lives_ok($$select * from public.update_member_access('e5555555-5555-4555-8555-555555555555', 'coordinator', 'suspended', null,
  'Cuotas pendientes del año rotario',
  (select updated_at from public.memberships where user_id = 'e5555555-5555-4555-8555-555555555555'))$$,
  'a manager can suspend a member with a reason');
select ok(
  exists (select 1 from public.membership_access_history
    where user_id = 'e5555555-5555-4555-8555-555555555555'
      and from_status = 'active' and to_status = 'suspended'
      and reason = 'Cuotas pendientes del año rotario'),
  'the suspension is recorded in the access history with its reason'
);
select is(
  pg_temp.notice_count('e5555555-5555-4555-8555-555555555555', 'Tu membresía fue suspendida', 'Cuotas pendientes del año rotario'), 1,
  'the suspended member is told the reason'
);
select throws_ok($$select public.update_member_access('e5555555-5555-4555-8555-555555555555', 'editor', 'suspended', null, null,
  (select updated_at from public.memberships where user_id = 'e5555555-5555-4555-8555-555555555555'))$$,
  '22023', 'reason_required', 'a role change without a reason is rejected even for a suspended member');

-- Reactivation keeps the original entry date. The date is set directly so the check is meaningful.
reset role;
update public.memberships set joined_at = now() - interval '200 days' where user_id = 'e5555555-5555-4555-8555-555555555555';
set local role authenticated;
select pg_temp.act_as('e3333333-3333-4333-8333-333333333333');
select lives_ok($$select * from public.update_member_access('e5555555-5555-4555-8555-555555555555', 'coordinator', 'active', null, null,
  (select updated_at from public.memberships where user_id = 'e5555555-5555-4555-8555-555555555555'))$$,
  'a suspended member can be reactivated without a new reason');
select is(
  pg_temp.notice_count('e5555555-5555-4555-8555-555555555555', 'Tu membresía fue reactivada'), 1,
  'the reactivated member is told'
);
select ok(
  (select joined_at = now() - interval '200 days' from public.memberships where user_id = 'e5555555-5555-4555-8555-555555555555'),
  'reactivation keeps the original entry date'
);

-- Administrator: may change a club management account.
select pg_temp.act_as('e1111111-1111-4111-8111-111111111111');
select lives_ok($$select * from public.update_member_access('e4444444-4444-4444-8444-444444444444', 'editor', 'active', null,
  'Cambio de responsabilidades del club',
  (select updated_at from public.memberships where user_id = 'e4444444-4444-4444-8444-444444444444'))$$,
  'an administrator can change a club management account');

-- Seats: a suspended member who still chairs a committee and holds a current cargo.
reset role;
insert into public.committees (name, slug) values ('Comité con cargos de reglas', 'comite-cargos-reglas');
insert into public.committee_members (committee_id, user_id, committee_role)
values ((select id from public.committees where slug = 'comite-cargos-reglas'), 'e8888888-8888-4888-8888-888888888888', 'chair');
insert into public.club_leadership_terms (start_year, label)
select private.current_rotary_year(), 'Periodo de prueba de reglas'
where not exists (select 1 from public.club_leadership_terms where start_year = private.current_rotary_year());
insert into public.club_leadership_positions (term_id, title, member_id)
values ((select id from public.club_leadership_terms where start_year = private.current_rotary_year()),
  'Cargo de prueba de reglas', 'e8888888-8888-4888-8888-888888888888');
set local role authenticated;
select pg_temp.act_as('e3333333-3333-4333-8333-333333333333');

select lives_ok($$select * from public.update_member_access('e8888888-8888-4888-8888-888888888888', 'member', 'suspended', null,
  'Suspensión de prueba con cargos',
  (select updated_at from public.memberships where user_id = 'e8888888-8888-4888-8888-888888888888'))$$,
  'a suspension with seats is accepted');
select is(
  pg_temp.notice_count('e3333333-3333-4333-8333-333333333333', 'Miembro suspendido con cargos', '1 comité(s) y 1 cargo(s)'), 1,
  'management is told that the suspended member still holds seats'
);
select is(
  (select count(*)::integer from public.committee_members where user_id = 'e8888888-8888-4888-8888-888888888888'), 1,
  'seats are reported, not removed automatically'
);

-- Last administrator: A is the only administrator once B is demoted.
select pg_temp.act_as('e1111111-1111-4111-8111-111111111111');
select lives_ok($$select * from public.update_member_access('e2222222-2222-4222-8222-222222222222', 'member', 'active', null,
  'Ajuste de prueba de administración',
  (select updated_at from public.memberships where user_id = 'e2222222-2222-4222-8222-222222222222'))$$,
  'an administrator can demote another administrator');
reset role;
select throws_ok($$update public.memberships set membership_role = 'member' where user_id = 'e1111111-1111-4111-8111-111111111111'$$,
  'P0410', 'last_admin', 'the last active administrator cannot be demoted');
select throws_ok($$update public.memberships set membership_status = 'suspended' where user_id = 'e1111111-1111-4111-8111-111111111111'$$,
  'P0410', 'last_admin', 'the last active administrator cannot be suspended');
set local role authenticated;
select pg_temp.act_as('e1111111-1111-4111-8111-111111111111');
select lives_ok($$select * from public.update_member_access('e2222222-2222-4222-8222-222222222222', 'admin', 'active', null,
  'Regreso a la administración del club',
  (select updated_at from public.memberships where user_id = 'e2222222-2222-4222-8222-222222222222'))$$,
  'an administrator can grant administration again');
reset role;
select lives_ok($$update public.memberships set membership_role = 'member' where user_id = 'e1111111-1111-4111-8111-111111111111'$$,
  'an administrator can be demoted when another active administrator remains');

-- Sign-up alerts after email confirmation. Unconfirmed accounts stay silent.
insert into public.membership_applications (full_name, email, phone, motivation, consented_to_member_sharing)
values
  ('Solicitud a rechazar', 'rules-pending@example.invalid', '+1 809 555 0707',
    'Quiero participar en las actividades sociales del club y en la revista.', true),
  ('Solicitante invitada', 'rules-invited@example.invalid', '+1 809 555 0808',
    'Quiero sumarme a los comités y servicios de la Zona Colonial.', true);
update public.membership_applications set status = 'invited', reviewed_by = 'e3333333-3333-4333-8333-333333333333'
where email = 'rules-invited@example.invalid';

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('e7777777-7777-4777-8777-777777777777', gen_random_uuid(), 'authenticated', 'authenticated', 'rules-pending@example.invalid', '', now(), '{}', '{"display_name":"Solicitud a rechazar"}', now() - interval '3 days', now()),
  ('ebbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', gen_random_uuid(), 'authenticated', 'authenticated', 'rules-confirmed@example.invalid', '', now(), '{}', '{"display_name":"Registro confirmado al crear"}', now() - interval '4 days', now()),
  ('eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', gen_random_uuid(), 'authenticated', 'authenticated', 'rules-unconfirmed@example.invalid', '', null, '{}', '{"display_name":"Persona sin confirmar"}', now() - interval '2 days', now()),
  ('e9999999-9999-4999-8999-999999999999', gen_random_uuid(), 'authenticated', 'authenticated', 'rules-invited@example.invalid', '', null, '{}', '{"display_name":"Solicitante invitada"}', now() - interval '1 day', now());

select is(
  pg_temp.notice_count('e3333333-3333-4333-8333-333333333333', 'Nuevo registro pendiente de aprobación', 'Persona sin confirmar'), 0,
  'an unconfirmed sign-up does not notify management'
);
select is(
  pg_temp.notice_count('e3333333-3333-4333-8333-333333333333', 'Nuevo registro pendiente de aprobación', 'Registro confirmado al crear'), 1,
  'a sign-up that is confirmed from the start notifies management once'
);
select is(
  pg_temp.notice_count('e3333333-3333-4333-8333-333333333333', 'Nuevo registro pendiente de aprobación', 'Solicitud a rechazar'), 1,
  'a confirmed sign-up with an open request is announced as pending approval'
);
select ok(
  (select invited_user_id is null from public.membership_applications where email = 'rules-invited@example.invalid'),
  'an invited applicant is not linked before the email is confirmed'
);
select is(
  pg_temp.notice_count('e3333333-3333-4333-8333-333333333333', 'Solicitante con cuenta creada', 'Solicitante invitada creó su cuenta'), 0,
  'the invitation link waits for the confirmed email'
);

-- Pending list: management only, newest first, matched to the application by invitation or email.
set local role authenticated;
select pg_temp.act_as('e3333333-3333-4333-8333-333333333333');
select is(
  (select array_agg(listed.user_id order by listed.registered_at desc)
   from public.list_pending_members() as listed
   where listed.user_id in ('e9999999-9999-4999-8999-999999999999', 'eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
     'e7777777-7777-4777-8777-777777777777', 'ebbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')),
  array['e9999999-9999-4999-8999-999999999999', 'eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'e7777777-7777-4777-8777-777777777777', 'ebbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']::uuid[],
  'pending members are listed newest first'
);
select ok(
  (select not listed.email_confirmed from public.list_pending_members() as listed where listed.user_id = 'eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  and (select not listed.email_confirmed from public.list_pending_members() as listed where listed.user_id = 'e9999999-9999-4999-8999-999999999999'),
  'the list shows which applicants have not confirmed their email'
);
select ok(
  (select listed.application_status = 'invited'
     and listed.application_id = (select id from public.membership_applications where email = 'rules-invited@example.invalid')
   from public.list_pending_members() as listed where listed.user_id = 'e9999999-9999-4999-8999-999999999999'),
  'an invited applicant is matched to the invitation'
);
select ok(
  (select listed.application_status = 'new' from public.list_pending_members() as listed
   where listed.user_id = 'e7777777-7777-4777-8777-777777777777'),
  'a sign-up is matched to its open request by email'
);

-- Confirmation of the remaining accounts: the link happens and management is told.
reset role;
update auth.users set email_confirmed_at = now() where id = 'eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
update auth.users set email_confirmed_at = now() where id = 'e9999999-9999-4999-8999-999999999999';
select is(
  pg_temp.notice_count('e3333333-3333-4333-8333-333333333333', 'Nuevo registro pendiente de aprobación', 'Persona sin confirmar creó su cuenta y espera aprobación.'), 1,
  'confirming the email announces the pending account'
);
select is(
  (select invited_user_id from public.membership_applications where email = 'rules-invited@example.invalid'),
  'e9999999-9999-4999-8999-999999999999'::uuid, 'confirming the invited email links the account to the invitation'
);
select is(
  pg_temp.notice_count('e3333333-3333-4333-8333-333333333333', 'Solicitante con cuenta creada', 'Solicitante invitada creó su cuenta'), 1,
  'management is told when the invited applicant creates the account'
);
select is(
  pg_temp.notice_count('e3333333-3333-4333-8333-333333333333', 'Nuevo registro pendiente de aprobación', 'Solicitante invitada'), 0,
  'a linked invitation is not announced twice'
);

-- Rejection: a reason is required, the account is deleted, the rejection is kept and the request is declined.
set local role authenticated;
select pg_temp.act_as('e3333333-3333-4333-8333-333333333333');
select throws_ok($$select public.reject_pending_member('e5555555-5555-4555-8555-555555555555', 'Motivo de prueba para miembro activo')$$,
  '22023', 'not_pending', 'only a pending membership can be rejected');
select throws_ok($$select public.reject_pending_member('e7777777-7777-4777-8777-777777777777', '   ')$$,
  '22023', 'reason_required', 'a rejection needs a reason');
select throws_ok($$select public.reject_pending_member('e7777777-7777-4777-8777-777777777777', 'no')$$,
  '22023', 'reason_length', 'a rejection reason must have 5 to 500 characters');
select pg_temp.act_without_mfa('e3333333-3333-4333-8333-333333333333');
select throws_ok($$select public.reject_pending_member('e7777777-7777-4777-8777-777777777777', 'Solicitud duplicada de otra cuenta')$$,
  '42501', null, 'without a recent second factor management cannot reject');
select pg_temp.act_as('e3333333-3333-4333-8333-333333333333');
select lives_ok($$select public.reject_pending_member('e7777777-7777-4777-8777-777777777777', 'Solicitud duplicada de otra cuenta')$$,
  'management rejects a pending sign-up with a reason');
select ok(
  exists (select 1 from public.membership_rejections
    where user_id = 'e7777777-7777-4777-8777-777777777777'
      and reason = 'Solicitud duplicada de otra cuenta'
      and rejected_by = 'e3333333-3333-4333-8333-333333333333'
      and display_name = 'Solicitud a rechazar'
      and email = 'rules-pending@example.invalid'),
  'the rejection record is kept with its reason and reviewer'
);
select ok(
  (select status = 'declined' and decision_reason = 'Solicitud duplicada de otra cuenta'
     and reviewed_by = 'e3333333-3333-4333-8333-333333333333' and invited_user_id is null
   from public.membership_applications where email = 'rules-pending@example.invalid'),
  'the matching request is declined with the same reason'
);
reset role;
select ok(not exists (select 1 from auth.users where id = 'e7777777-7777-4777-8777-777777777777'),
  'the rejected sign-up is deleted from authentication');
select ok(not exists (select 1 from public.profiles where id = 'e7777777-7777-4777-8777-777777777777')
  and not exists (select 1 from public.memberships where user_id = 'e7777777-7777-4777-8777-777777777777'),
  'the rejected sign-up leaves no profile or membership behind');

-- Committees: club management creates, edits, finishes, reopens and staffs them; one chair per committee.
set local role authenticated;
select pg_temp.act_as('e3333333-3333-4333-8333-333333333333');
select lives_ok($$select public.create_committee_with_members('Comité de reglas', 'comite-reglas-prueba', null,
  array['e6666666-6666-4666-8666-666666666666']::uuid[], array['chair']::text[])$$,
  'club management creates a committee with its chair');
select throws_ok($$select public.create_committee_with_members('Comité doble presidencia', 'comite-doble-presidencia', null,
  array['e6666666-6666-4666-8666-666666666666', 'e5555555-5555-4555-8555-555555555555']::uuid[], array['chair', 'chair']::text[])$$,
  '22023', 'A committee can have only one chair.', 'a committee cannot be created with two chairs');
select lives_ok($$update public.committees set description = 'Descripción de prueba de reglas' where slug = 'comite-reglas-prueba'$$,
  'club management edits a committee');
select lives_ok($$update public.committees set is_active = false where slug = 'comite-reglas-prueba'$$,
  'club management finishes a committee');
select lives_ok($$update public.committees set is_active = true where slug = 'comite-reglas-prueba'$$,
  'club management reopens a finished committee');
select is((select is_active from public.committees where slug = 'comite-reglas-prueba'), true,
  'the reopened committee is active again');
select lives_ok($$insert into public.committee_members (committee_id, user_id, committee_role)
  values ((select id from public.committees where slug = 'comite-reglas-prueba'), 'e5555555-5555-4555-8555-555555555555', 'member')$$,
  'club management adds a member to the reopened committee');
select throws_ok($$update public.committee_members set committee_role = 'chair'
  where user_id = 'e5555555-5555-4555-8555-555555555555'
    and committee_id = (select id from public.committees where slug = 'comite-reglas-prueba')$$,
  '23505', null, 'a second chair cannot be appointed while one is in office');

-- Members: own role and status, never their private notes.
select pg_temp.act_as('e6666666-6666-4666-8666-666666666666');
select is((select membership_status from public.memberships where user_id = 'e6666666-6666-4666-8666-666666666666'), 'active',
  'a member reads their own status');
select throws_ok($$select notes from public.memberships where user_id = 'e6666666-6666-4666-8666-666666666666'$$,
  '42501', null, 'a member cannot read their own private notes');
select throws_ok($$select * from public.get_membership_notes(array['e6666666-6666-4666-8666-666666666666']::uuid[])$$,
  '42501', null, 'a member cannot read notes through the function');
select throws_ok($$update public.memberships set membership_status = 'pending' where user_id = 'e6666666-6666-4666-8666-666666666666'$$,
  '42501', null, 'a member cannot change their own membership');
select is((select count(*)::integer from public.membership_access_history), 0,
  'a member cannot read the access history');
select throws_ok($$select * from public.list_pending_members()$$,
  '42501', null, 'a member cannot list pending members');
select throws_ok($$select public.reject_pending_member('e7777777-7777-4777-8777-777777777777', 'Intento de miembro ordinario')$$,
  '42501', null, 'a member cannot reject a sign-up');

-- Management reads the history; nobody writes it directly.
select pg_temp.act_as('e3333333-3333-4333-8333-333333333333');
select ok((select count(*) >= 1 from public.membership_access_history),
  'management reads the access history');
select throws_ok($$insert into public.membership_access_history (user_id, from_role, to_role, from_status, to_status)
  values ('e5555555-5555-4555-8555-555555555555', 'member', 'admin', 'active', 'active')$$,
  '42501', null, 'the access history cannot be written directly');

reset role;
select * from finish();
rollback;
