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
  ('b1111111-1111-4111-8111-111111111111', gen_random_uuid(), 'authenticated', 'authenticated', 'round-coordinator@example.invalid', '', now(), '{}', '{}'),
  ('b2222222-2222-4222-8222-222222222222', gen_random_uuid(), 'authenticated', 'authenticated', 'round-author@example.invalid', '', now(), '{}', '{}'),
  ('b3333333-3333-4333-8333-333333333333', gen_random_uuid(), 'authenticated', 'authenticated', 'round-voter-a@example.invalid', '', now(), '{}', '{}'),
  ('b4444444-4444-4444-8444-444444444444', gen_random_uuid(), 'authenticated', 'authenticated', 'round-voter-b@example.invalid', '', now(), '{}', '{}'),
  ('b5555555-5555-4555-8555-555555555555', gen_random_uuid(), 'authenticated', 'authenticated', 'round-pending@example.invalid', '', now(), '{}', '{}');
-- Only this suite's members are active, so eligible voters are exactly four.
update public.memberships set membership_status = 'suspended' where user_id::text not like 'b_______-____-4___-8___-____________';
update public.memberships set membership_status = case when user_id = 'b5555555-5555-4555-8555-555555555555' then 'pending' else 'active' end,
  membership_role = case when user_id = 'b1111111-1111-4111-8111-111111111111' then 'coordinator' else 'member' end
where user_id::text like 'b_______-____-4___-8___-____________';

create function pg_temp.act_as(_user uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', _user::text, true),
         set_config('request.jwt.claims', jsonb_build_object('sub', _user, 'session_id', _user, 'role', 'authenticated', 'aal', 'aal2',
           'amr', jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint)))::text, true);
$$;
create function pg_temp.notices(_user uuid, _title text) returns integer language sql security definer as $$
  select count(*)::integer from public.notifications where user_id = _user and title = _title;
$$;
grant execute on function pg_temp.notices(uuid, text) to authenticated;

set local role authenticated;

-- 7. Drafts are private to the author.
select pg_temp.act_as('b2222222-2222-4222-8222-222222222222');
insert into public.proposals (id, title, summary, created_by)
values ('b9999999-9999-4999-8999-999999999999', 'Huerto en la sede', 'Un huerto comunitario para la sede del club.', auth.uid());
select pg_temp.act_as('b1111111-1111-4111-8111-111111111111');
select is((select count(*)::integer from public.proposals where id = 'b9999999-9999-4999-8999-999999999999'), 0,
  'coordination cannot see another member''s draft');

-- 1. Submission notifies coordination and starts the history.
select pg_temp.act_as('b2222222-2222-4222-8222-222222222222');
select lives_ok($$select public.submit_proposal('b9999999-9999-4999-8999-999999999999')$$, 'the author submits the proposal');
select is(pg_temp.notices('b1111111-1111-4111-8111-111111111111', 'Nueva propuesta para revisar'), 1, 'coordination is notified of a submission');
select is((select count(*)::integer from public.proposal_history where proposal_id = 'b9999999-9999-4999-8999-999999999999' and event = 'submitted'), 1,
  'the submission is recorded in the history');

-- 1. Opening the ballot notifies active members.
select pg_temp.act_as('b1111111-1111-4111-8111-111111111111');
update public.proposals set voting_open = true where id = 'b9999999-9999-4999-8999-999999999999';
select is(pg_temp.notices('b3333333-3333-4333-8333-333333333333', 'Votación abierta'), 1, 'active members are told the ballot opened');
select is(pg_temp.notices('b5555555-5555-4555-8555-555555555555', 'Votación abierta'), 0, 'pending accounts are not notified');

-- 3. Participation is visible only after voting.
select pg_temp.act_as('b3333333-3333-4333-8333-333333333333');
insert into public.proposal_votes (proposal_id, user_id, vote_choice) values ('b9999999-9999-4999-8999-999999999999', auth.uid(), 'for');
select is((select voters || '/' || eligible_voters from public.get_proposal_voting_summaries(array['b9999999-9999-4999-8999-999999999999'::uuid])), '1/4',
  'a member who voted sees participation');
select is((select votes_for from public.get_proposal_voting_summaries(array['b9999999-9999-4999-8999-999999999999'::uuid])), null::integer,
  'the tally stays hidden while the ballot is open');
select pg_temp.act_as('b4444444-4444-4444-8444-444444444444');
select is((select voters from public.get_proposal_voting_summaries(array['b9999999-9999-4999-8999-999999999999'::uuid])), null::integer,
  'a member who has not voted cannot see participation');
insert into public.proposal_votes (proposal_id, user_id, vote_choice) values ('b9999999-9999-4999-8999-999999999999', auth.uid(), 'against');

-- 4. A tie cannot be approved; coordination starts a runoff.
select pg_temp.act_as('b1111111-1111-4111-8111-111111111111');
update public.proposals set voting_open = false where id = 'b9999999-9999-4999-8999-999999999999';
select throws_ok($$update public.proposals set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now() where id = 'b9999999-9999-4999-8999-999999999999'$$,
  'proposal_vote_tied', null, 'approving a tied ballot is refused');
select is(public.start_proposal_runoff('b9999999-9999-4999-8999-999999999999'), 2, 'the runoff opens round two');
select ok((select voting_open and ballot_round = 2 from public.proposals where id = 'b9999999-9999-4999-8999-999999999999'),
  'the runoff ballot is open');
select is((select count(*)::integer from public.get_proposal_voting_summaries(array['b9999999-9999-4999-8999-999999999999'::uuid]) where my_vote is not null), 0,
  'previous votes do not carry into the runoff');
select is((select tally from public.proposal_history where proposal_id = 'b9999999-9999-4999-8999-999999999999' and event = 'tie_runoff'),
  '{"for": 1, "against": 1, "abstain": 0}'::jsonb, 'the tied tally is kept in the history');
select is(pg_temp.notices('b3333333-3333-4333-8333-333333333333', 'Votación de desempate abierta'), 1, 'members are told about the runoff');

-- 1. A decision notifies the author.
select pg_temp.act_as('b3333333-3333-4333-8333-333333333333');
insert into public.proposal_votes (proposal_id, user_id, vote_choice) values ('b9999999-9999-4999-8999-999999999999', auth.uid(), 'for');
select pg_temp.act_as('b1111111-1111-4111-8111-111111111111');
update public.proposals set voting_open = false where id = 'b9999999-9999-4999-8999-999999999999';
update public.proposals set status = 'rejected', review_notes = 'Falta el presupuesto del huerto.', reviewed_by = auth.uid(), reviewed_at = now()
where id = 'b9999999-9999-4999-8999-999999999999';
select is(pg_temp.notices('b2222222-2222-4222-8222-222222222222', 'Decisión sobre tu propuesta'), 1, 'the author is told about the decision');

-- 2. Correcting a returned proposal starts a new round and tells previous voters.
select pg_temp.act_as('b2222222-2222-4222-8222-222222222222');
update public.proposals set status = 'draft', details = 'Presupuesto: RD$20,000.', reviewed_by = null, reviewed_at = null, submitted_at = null
where id = 'b9999999-9999-4999-8999-999999999999';
select ok((select ballot_round = 3 and voting_started_at is null and not voting_open from public.proposals where id = 'b9999999-9999-4999-8999-999999999999'),
  'the correction starts round three with no ballot yet');
select is(pg_temp.notices('b3333333-3333-4333-8333-333333333333', 'Propuesta corregida: nueva votación'), 1, 'previous voters are told their vote was archived');
select is((select count(*)::integer from public.proposal_history where proposal_id = 'b9999999-9999-4999-8999-999999999999' and event = 'corrected'), 1,
  'the correction is recorded with the previous tally');
update public.proposals set ballot_round = 99 where id = 'b9999999-9999-4999-8999-999999999999';
select is((select ballot_round from public.proposals where id = 'b9999999-9999-4999-8999-999999999999'), 3, 'clients cannot move the ballot round');

-- 9. History is readable by members who can see the proposal.
select lives_ok($$select public.submit_proposal('b9999999-9999-4999-8999-999999999999')$$, 'the corrected proposal is resubmitted');
select pg_temp.act_as('b4444444-4444-4444-8444-444444444444');
select ok((select count(*) >= 7 from public.proposal_history where proposal_id = 'b9999999-9999-4999-8999-999999999999'),
  'members can read the full history of a visible proposal');

reset role;
select * from finish();
rollback;
