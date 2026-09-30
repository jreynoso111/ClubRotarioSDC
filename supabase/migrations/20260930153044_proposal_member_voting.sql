-- Keep proposal authorship immutable and let active members vote on submitted
-- proposals when an authorized coordinator activates the ballot.

alter table public.proposals
  add column voting_open boolean not null default false,
  add column voting_started_at timestamptz;

alter table public.proposals
  add constraint proposals_voting_status_check
  check (not voting_open or status in ('submitted', 'in_review'));

create index proposals_open_voting_idx
  on public.proposals (submitted_at desc, id)
  where voting_open = true;

create table public.proposal_votes (
  proposal_id uuid not null references public.proposals (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  vote_choice text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (proposal_id, user_id),
  constraint proposal_votes_choice_check
    check (vote_choice in ('for', 'against', 'abstain'))
);

create index proposal_votes_user_proposal_idx
  on public.proposal_votes (user_id, proposal_id);

alter table public.proposal_votes enable row level security;
revoke all on public.proposal_votes from public, anon, authenticated;
grant select on public.proposal_votes to authenticated;
grant insert (proposal_id, user_id, vote_choice) on public.proposal_votes to authenticated;
grant update (proposal_id, user_id, vote_choice) on public.proposal_votes to authenticated;

create policy proposals_select_active_members
on public.proposals for select
to authenticated
using (
  (select private.is_active_member())
  and status in ('submitted', 'in_review', 'approved', 'rejected')
);

create policy proposal_votes_select_own_active_member
on public.proposal_votes for select
to authenticated
using (
  (select auth.uid()) = user_id
  and (select private.is_active_member())
);

create policy proposal_votes_insert_open_ballot
on public.proposal_votes for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and (select private.is_active_member())
  and exists (
    select 1
    from public.proposals as proposal
    where proposal.id = proposal_id
      and proposal.voting_open = true
      and proposal.status in ('submitted', 'in_review')
  )
);

create policy proposal_votes_update_open_ballot
on public.proposal_votes for update
to authenticated
using (
  (select auth.uid()) = user_id
  and (select private.is_active_member())
  and exists (
    select 1
    from public.proposals as proposal
    where proposal.id = proposal_id
      and proposal.voting_open = true
      and proposal.status in ('submitted', 'in_review')
  )
)
with check (
  (select auth.uid()) = user_id
  and (select private.is_active_member())
  and exists (
    select 1
    from public.proposals as proposal
    where proposal.id = proposal_id
      and proposal.voting_open = true
      and proposal.status in ('submitted', 'in_review')
  )
);

create trigger proposal_votes_set_updated_at
before update on public.proposal_votes
for each row execute function private.set_updated_at();

create function private.guard_proposal_vote_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.proposal_id is distinct from old.proposal_id
    or new.user_id is distinct from old.user_id
    or new.created_at is distinct from old.created_at then
    raise exception 'A ballot cannot be reassigned.' using errcode = '42501';
  end if;

  return new;
end;
$$;
revoke all on function private.guard_proposal_vote_identity() from public, anon, authenticated, service_role;

create trigger proposal_votes_guard_identity
before update on public.proposal_votes
for each row execute function private.guard_proposal_vote_identity();

create function private.guard_proposal_voting()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.created_by is distinct from old.created_by then
    raise exception 'Proposal authorship cannot be changed.' using errcode = '42501';
  end if;

  -- A final decision closes an active ballot. Authorized club managers can open
  -- one, and the database constraint limits it to reviewable proposals.
  if new.voting_open and new.status not in ('submitted', 'in_review') then
    if old.voting_open then
      new.voting_open := false;
    else
      raise exception 'Voting is available only while a proposal is under review.' using errcode = '23514';
    end if;
  end if;

  new.voting_started_at := old.voting_started_at;
  if new.voting_open and not old.voting_open then
    new.voting_started_at := coalesce(old.voting_started_at, now());
  end if;

  return new;
end;
$$;
revoke all on function private.guard_proposal_voting() from public, anon, authenticated, service_role;

create trigger proposals_guard_voting
before update on public.proposals
for each row execute function private.guard_proposal_voting();

create function public.get_proposal_voting_summaries(_proposal_ids uuid[])
returns table (
  proposal_id uuid,
  author_name text,
  voting_open boolean,
  voting_started_at timestamptz,
  votes_for integer,
  votes_against integer,
  votes_abstaining integer,
  my_vote text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is null or not (select private.is_active_member()) then
    raise exception 'Active membership required.' using errcode = '42501';
  end if;

  if coalesce(cardinality(_proposal_ids), 0) > 50 then
    raise exception 'Too many proposal identifiers.' using errcode = '22023';
  end if;

  return query
  select
    proposal.id,
    coalesce(nullif(btrim(profile.display_name), ''), 'Miembro del club'),
    proposal.voting_open,
    proposal.voting_started_at,
    case when proposal.voting_open then null
      else (count(vote.user_id) filter (where vote.vote_choice = 'for'))::integer end,
    case when proposal.voting_open then null
      else (count(vote.user_id) filter (where vote.vote_choice = 'against'))::integer end,
    case when proposal.voting_open then null
      else (count(vote.user_id) filter (where vote.vote_choice = 'abstain'))::integer end,
    max(vote.vote_choice) filter (where vote.user_id = actor_id)
  from public.proposals as proposal
  left join public.profiles as profile on profile.id = proposal.created_by
  left join public.proposal_votes as vote on vote.proposal_id = proposal.id
  where proposal.id = any(coalesce(_proposal_ids, '{}'::uuid[]))
    and (
      proposal.created_by = actor_id
      or proposal.status in ('submitted', 'in_review', 'approved', 'rejected')
      or (select private.has_any_role(array['coordinator', 'club_manager', 'admin']))
    )
  group by proposal.id, profile.display_name, proposal.voting_open, proposal.voting_started_at
  order by proposal.id;
end;
$$;
revoke all on function public.get_proposal_voting_summaries(uuid[]) from public, anon, authenticated;
grant execute on function public.get_proposal_voting_summaries(uuid[]) to authenticated;

-- The tally is a secret ballot. The administrator audit trail records that a
-- member voted, but deliberately omits the ballot choice and individual result.
create function private.capture_proposal_vote_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  proposal_uuid uuid := coalesce(new.proposal_id, old.proposal_id);
  actor_uuid uuid := auth.uid();
  actor_label text;
  actor_membership text;
  proposal_label text;
begin
  if tg_op = 'UPDATE' and old.vote_choice is not distinct from new.vote_choice then
    return null;
  end if;

  select profile.display_name, membership.membership_role
    into actor_label, actor_membership
  from public.profiles as profile
  left join public.memberships as membership on membership.user_id = profile.id
  where profile.id = actor_uuid;

  select proposal.title into proposal_label
  from public.proposals as proposal
  where proposal.id = proposal_uuid;

  insert into public.audit_log (
    actor_id, actor_name, actor_role, source, schema_name, table_name, operation,
    record_id, record_key, entity_label, changed_fields, context
  ) values (
    actor_uuid,
    coalesce(nullif(btrim(actor_label), ''), 'Miembro del club'),
    coalesce(actor_membership, 'member'),
    'database', 'public', 'proposal_votes', tg_op,
    proposal_uuid::text, jsonb_build_object('proposal_id', proposal_uuid),
    coalesce('Votación · ' || nullif(btrim(proposal_label), ''), 'Votación de propuesta'),
    array[case tg_op
      when 'INSERT' then 'voto_emitido'
      when 'UPDATE' then 'voto_actualizado'
      else 'voto_eliminado'
    end],
    jsonb_build_object('boleta_secreta', true)
  );
  return null;
end;
$$;
revoke all on function private.capture_proposal_vote_activity() from public, anon, authenticated, service_role;

create trigger proposal_votes_audit_activity
after insert or update or delete on public.proposal_votes
for each row execute function private.capture_proposal_vote_activity();

notify pgrst, 'reload schema';
