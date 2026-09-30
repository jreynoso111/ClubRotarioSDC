begin;
select plan(15);

select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'proposals'
      and column_name = 'voting_open' and is_nullable = 'NO'
  ),
  'proposals store an explicit, closed-by-default voting state'
);

select ok(
  exists (
    select 1 from pg_class
    where oid = 'public.proposal_votes'::regclass and relrowsecurity
  ),
  'proposal ballots have row-level security enabled'
);

select is(
  (
    select array_agg(attribute.attname::text order by key.ordinality)
    from pg_index as index
    cross join lateral unnest(index.indkey) with ordinality as key(attnum, ordinality)
    join pg_attribute as attribute on attribute.attrelid = index.indrelid and attribute.attnum = key.attnum
    where index.indrelid = 'public.proposal_votes'::regclass
      and index.indisprimary and key.ordinality <= index.indnkeyatts
  ),
  array['proposal_id', 'user_id']::text[],
  'each active member has at most one ballot per proposal'
);

select ok(
  has_function_privilege('authenticated', 'public.get_proposal_voting_summaries(uuid[])', 'EXECUTE')
    and not has_function_privilege('anon', 'public.get_proposal_voting_summaries(uuid[])', 'EXECUTE'),
  'only authenticated clients can request authorized voting summaries'
);

select is(
  (select count(*)::integer from pg_policies
    where schemaname = 'public' and tablename = 'proposal_votes'
      and policyname in (
        'proposal_votes_select_own_active_member',
        'proposal_votes_insert_open_ballot',
        'proposal_votes_update_open_ballot'
      )),
  3,
  'ballot reads and writes are separated into owner and open-ballot policies'
);

select ok(
  has_column_privilege('authenticated', 'public.proposal_votes', 'vote_choice', 'UPDATE')
    and not has_column_privilege('authenticated', 'public.proposal_votes', 'created_at', 'UPDATE'),
  'authenticated members can change a ballot choice but cannot rewrite ballot timestamps'
);

create temporary table proposal_voting_fixture (
  author_id uuid not null,
  first_voter uuid not null,
  second_voter uuid not null,
  coordinator_id uuid not null,
  suspended_id uuid not null,
  proposal_id uuid not null
);

insert into proposal_voting_fixture
values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid());

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select fixture_id, gen_random_uuid(), 'authenticated', 'authenticated',
       fixture_id::text || '@proposal-voting.test', '', now(), '{}'::jsonb, '{}'::jsonb,
       now(), now()
from (
  select author_id as fixture_id from proposal_voting_fixture
  union all select first_voter from proposal_voting_fixture
  union all select second_voter from proposal_voting_fixture
  union all select coordinator_id from proposal_voting_fixture
  union all select suspended_id from proposal_voting_fixture
) as fixtures;

update public.profiles
set display_name = case id
  when (select author_id from proposal_voting_fixture) then 'Autora de prueba'
  else 'Miembro de prueba'
end
where id in (
  (select author_id from proposal_voting_fixture),
  (select first_voter from proposal_voting_fixture),
  (select second_voter from proposal_voting_fixture),
  (select coordinator_id from proposal_voting_fixture),
  (select suspended_id from proposal_voting_fixture)
);

update public.memberships
set membership_role = case
      when user_id = (select coordinator_id from proposal_voting_fixture) then 'coordinator'
      else 'member'
    end,
    membership_status = case
      when user_id = (select suspended_id from proposal_voting_fixture) then 'suspended'
      else 'active'
    end
where user_id in (
  (select author_id from proposal_voting_fixture),
  (select first_voter from proposal_voting_fixture),
  (select second_voter from proposal_voting_fixture),
  (select coordinator_id from proposal_voting_fixture),
  (select suspended_id from proposal_voting_fixture)
);

grant select on proposal_voting_fixture to authenticated;

insert into public.proposals (id, title, summary, details, status, created_by)
select proposal_id, 'Proyecto comunitario', 'Una idea para el servicio del club.', '', 'submitted', author_id
from proposal_voting_fixture;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', (select coordinator_id::text from proposal_voting_fixture), true);

update public.proposals set voting_open = true
where id = (select proposal_id from proposal_voting_fixture);

select ok(
  (select voting_open from public.proposals where id = (select proposal_id from proposal_voting_fixture)),
  'an active coordinator can activate a ballot for a submitted proposal'
);

select set_config('request.jwt.claim.sub', (select first_voter::text from proposal_voting_fixture), true);

select is(
  (select count(*)::integer from public.proposals where id = (select proposal_id from proposal_voting_fixture)),
  1,
  'an active member can see a submitted proposal while voting is enabled'
);

insert into public.proposal_votes (proposal_id, user_id, vote_choice)
select proposal_id, first_voter, 'for' from proposal_voting_fixture;

select is(
  (select count(*)::integer from public.proposal_votes),
  1,
  'a member can cast a ballot as their authenticated account'
);

select ok(
  (select author_name = 'Autora de prueba' and voting_open and votes_for is null and my_vote = 'for'
   from public.get_proposal_voting_summaries(array[(select proposal_id from proposal_voting_fixture)])),
  'voting summary shows the proposal author and hides interim totals while retaining the member own vote'
);

update public.proposal_votes set vote_choice = 'abstain'
where proposal_id = (select proposal_id from proposal_voting_fixture);

select is(
  (select count(*)::integer from public.proposal_votes),
  1,
  'changing a ballot updates the member existing vote instead of creating another one'
);

select set_config('request.jwt.claim.sub', (select second_voter::text from proposal_voting_fixture), true);

select is(
  (select count(*)::integer from public.proposal_votes),
  0,
  'members cannot read another member individual ballot'
);

insert into public.proposal_votes (proposal_id, user_id, vote_choice)
select proposal_id, second_voter, 'against' from proposal_voting_fixture;

select set_config('request.jwt.claim.sub', (select coordinator_id::text from proposal_voting_fixture), true);
update public.proposals set voting_open = false
where id = (select proposal_id from proposal_voting_fixture);

select set_config('request.jwt.claim.sub', (select first_voter::text from proposal_voting_fixture), true);

select is(
  (select concat(votes_for, ':', votes_against, ':', votes_abstaining)
   from public.get_proposal_voting_summaries(array[(select proposal_id from proposal_voting_fixture)])),
  '0:1:1',
  'members can see the aggregate result after a coordinator closes the ballot'
);

reset role;

select ok(
  (select count(*)::integer = 3
     and bool_and(before_data is null and after_data is null and context->>'boleta_secreta' = 'true')
   from public.audit_log where table_name = 'proposal_votes'
     and record_id = (select proposal_id::text from proposal_voting_fixture)),
  'administrator audit records participation but never the ballot choice'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', (select suspended_id::text from proposal_voting_fixture), true);

do $$
begin
  begin
    insert into public.proposal_votes (proposal_id, user_id, vote_choice)
    select proposal_id, suspended_id, 'abstain' from proposal_voting_fixture;
    raise exception 'Suspended member was able to vote';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

reset role;

do $$
begin
  begin
    update public.proposals set created_by = (select second_voter from proposal_voting_fixture)
    where id = (select proposal_id from proposal_voting_fixture);
    raise exception 'Proposal author was changed';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

select ok(true, 'proposal authorship cannot be reassigned after creation');

select * from finish();
rollback;
