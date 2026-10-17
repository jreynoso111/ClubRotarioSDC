-- Proposal rules agreed with the club (2026-10-17):
-- 1. Notify coordination on submission, members when a ballot opens and the
--    author when a decision is recorded.
-- 2. A corrected proposal starts a new ballot round; previous voters are told
--    what happened and the old tally stays in the history.
-- 3. Participation (who has voted, not how) is visible once you have voted.
-- 4. Approving a tied ballot (for = against > 0) is refused; coordination
--    starts a runoff round instead (start_proposal_runoff).
-- 7. Drafts are private to their author.
-- 9. Every lifecycle step is kept in public.proposal_history.

alter table public.proposals add column ballot_round integer not null default 1;
alter table public.proposals add constraint proposals_ballot_round_positive check (ballot_round >= 1);

create table public.proposal_history (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.proposals (id) on delete cascade,
  event text not null check (event in (
    'submitted', 'in_review', 'approved', 'rejected', 'archived',
    'corrected', 'voting_opened', 'voting_closed', 'tie_runoff'
  )),
  ballot_round integer not null,
  notes text check (notes is null or char_length(notes) <= 4000),
  tally jsonb,
  actor_id uuid references public.profiles (id) on delete set null,
  actor_name text not null,
  created_at timestamptz not null default clock_timestamp()
);
create index proposal_history_proposal_idx on public.proposal_history (proposal_id, created_at);
create trigger zz_club_audit after insert or update or delete on public.proposal_history for each row execute function private.capture_club_audit_change('id');
alter table public.proposal_history enable row level security;
revoke all on public.proposal_history from anon, authenticated;
grant select on public.proposal_history to authenticated;
-- Visible exactly when the proposal itself is visible to the reader.
create policy proposal_history_follows_proposal on public.proposal_history
for select to authenticated
using (exists (select 1 from public.proposals as proposal where proposal.id = proposal_history.proposal_id));

-- Drafts are private to their author, also for coordination and management.
drop policy proposals_select_management on public.proposals;
create policy proposals_select_management on public.proposals
for select to authenticated
using ((select private.has_any_role(array['coordinator', 'club_manager', 'admin'])) and status <> 'draft');
drop policy proposals_update_management on public.proposals;
create policy proposals_update_management on public.proposals
for update to authenticated
using ((select private.has_any_role(array['coordinator', 'club_manager', 'admin'])) and status <> 'draft')
with check ((select private.has_any_role(array['coordinator', 'club_manager', 'admin'])));
drop policy proposals_delete_management on public.proposals;
create policy proposals_delete_management on public.proposals
for delete to authenticated
using ((select private.has_any_role(array['club_manager', 'admin'])) and status <> 'draft');

create or replace function private.proposal_tally(_proposal_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'for', count(*) filter (where vote.vote_choice = 'for'),
    'against', count(*) filter (where vote.vote_choice = 'against'),
    'abstain', count(*) filter (where vote.vote_choice = 'abstain'))
  from public.proposal_votes as vote
  where vote.proposal_id = _proposal_id;
$$;

create or replace function private.actor_display_name()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select nullif(btrim(profile.display_name), '') from public.profiles as profile where profile.id = (select auth.uid())),
    'Club Rotario');
$$;

create or replace function private.notify_users(_users uuid[], _title text, _body text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, kind, title, body, href)
  select recipient, 'proposal', left(_title, 180), left(_body, 1000), '/plataforma?tab=propuestas'
  from unnest(_users) as recipient
  where recipient is not null and recipient is distinct from (select auth.uid());
$$;

-- BEFORE UPDATE, after proposals_guard_voting (alphabetical trigger order).
create or replace function private.proposal_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  tally jsonb;
  previous_voters uuid[];
  restarting boolean := current_setting('club.ballot_restart', true) = 'on';
begin
  -- The round only advances through this trigger or start_proposal_runoff.
  if new.ballot_round is distinct from old.ballot_round and not restarting then
    new.ballot_round := old.ballot_round;
  end if;
  if restarting and new.ballot_round > old.ballot_round and new.voting_open then
    new.voting_started_at := now();
  end if;

  -- 4. A tied ballot cannot be approved.
  if new.status = 'approved' and old.status is distinct from 'approved' and old.voting_started_at is not null then
    tally := private.proposal_tally(old.id);
    if (tally ->> 'for')::integer > 0 and (tally ->> 'for')::integer = (tally ->> 'against')::integer then
      raise exception 'proposal_vote_tied' using errcode = 'P0001';
    end if;
  end if;

  -- 2. Saving a correction of a returned proposal starts a fresh round.
  if old.status = 'rejected' and new.status = 'draft' and old.voting_started_at is not null then
    tally := private.proposal_tally(old.id);
    select array_agg(vote.user_id) into previous_voters from public.proposal_votes as vote where vote.proposal_id = old.id;
    delete from public.proposal_votes where proposal_id = old.id;
    insert into public.proposal_history (proposal_id, event, ballot_round, tally, actor_id, actor_name)
    values (old.id, 'corrected', old.ballot_round, tally, (select auth.uid()), private.actor_display_name());
    new.ballot_round := old.ballot_round + 1;
    new.voting_open := false;
    new.voting_started_at := null;
    perform private.notify_users(previous_voters, 'Propuesta corregida: nueva votación',
      format('«%s» fue corregida por su autor. Tu voto anterior quedó archivado; podrás votar de nuevo cuando se abra la nueva ronda.', left(new.title, 120)));
  end if;
  return new;
end;
$$;

create trigger proposals_lifecycle
before update on public.proposals
for each row execute function private.proposal_lifecycle();

-- AFTER UPDATE: history and notifications.
create or replace function private.proposal_after_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  actor_label text := private.actor_display_name();
  coordination uuid[];
  members uuid[];
  status_text text;
begin
  if new.status = 'submitted' and old.status is distinct from 'submitted' then
    insert into public.proposal_history (proposal_id, event, ballot_round, actor_id, actor_name)
    values (new.id, 'submitted', new.ballot_round, actor, actor_label);
    select array_agg(membership.user_id) into coordination from public.memberships as membership
    where membership.membership_status = 'active' and membership.membership_role in ('coordinator', 'club_manager', 'admin')
      and membership.user_id <> new.created_by;
    perform private.notify_users(coordination, 'Nueva propuesta para revisar', format('«%s» espera revisión.', left(new.title, 140)));
  end if;

  if new.status in ('in_review', 'approved', 'rejected', 'archived')
     and (new.status is distinct from old.status or new.review_notes is distinct from old.review_notes or new.reviewed_at is distinct from old.reviewed_at) then
    insert into public.proposal_history (proposal_id, event, ballot_round, notes, actor_id, actor_name)
    values (new.id, new.status, new.ballot_round, new.review_notes, actor, actor_label);
    status_text := case new.status
      when 'in_review' then 'quedó en revisión'
      when 'approved' then 'fue aprobada'
      when 'rejected' then 'fue devuelta para corrección'
      else 'fue archivada' end;
    perform private.notify_users(array[new.created_by], 'Decisión sobre tu propuesta',
      format('«%s» %s.%s', left(new.title, 120), status_text, coalesce(' ' || left(new.review_notes, 400), '')));
  end if;

  if new.voting_open and not old.voting_open then
    insert into public.proposal_history (proposal_id, event, ballot_round, actor_id, actor_name)
    values (new.id, 'voting_opened', new.ballot_round, actor, actor_label);
    select array_agg(membership.user_id) into members from public.memberships as membership
    where membership.membership_status = 'active';
    perform private.notify_users(members,
      case when new.ballot_round > old.ballot_round then 'Votación de desempate abierta' else 'Votación abierta' end,
      format('Ya puedes votar «%s».', left(new.title, 140)));
  elsif old.voting_open and not new.voting_open then
    insert into public.proposal_history (proposal_id, event, ballot_round, tally, actor_id, actor_name)
    values (new.id, 'voting_closed', new.ballot_round, private.proposal_tally(new.id), actor, actor_label);
  end if;
  return null;
end;
$$;

create trigger proposals_after_change
after update on public.proposals
for each row execute function private.proposal_after_change();

-- 4. Runoff for a tied, closed ballot. Coordination only.
create or replace function public.start_proposal_runoff(_proposal_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.proposals;
  tally jsonb;
begin
  if (select auth.uid()) is null or not (select private.has_any_role(array['coordinator', 'club_manager', 'admin'])) then
    raise exception 'Club coordination required.' using errcode = '42501';
  end if;
  select * into target from public.proposals where id = _proposal_id for update;
  if target.id is null or target.status not in ('submitted', 'in_review') or target.voting_open or target.voting_started_at is null then
    raise exception 'The proposal has no closed ballot to break a tie.' using errcode = '22023';
  end if;
  tally := private.proposal_tally(target.id);
  if not ((tally ->> 'for')::integer > 0 and (tally ->> 'for')::integer = (tally ->> 'against')::integer) then
    raise exception 'The ballot is not tied.' using errcode = '22023';
  end if;
  insert into public.proposal_history (proposal_id, event, ballot_round, tally, actor_id, actor_name)
  values (target.id, 'tie_runoff', target.ballot_round, tally, (select auth.uid()), private.actor_display_name());
  delete from public.proposal_votes where proposal_id = target.id;
  perform set_config('club.ballot_restart', 'on', true);
  update public.proposals set ballot_round = target.ballot_round + 1, voting_open = true where id = target.id;
  perform set_config('club.ballot_restart', 'off', true);
  return target.ballot_round + 1;
end;
$$;

-- 3. Summaries add the round and, once the reader has voted (or the ballot is
-- closed), how many members voted out of the active membership.
drop function public.get_proposal_voting_summaries(uuid[]);
create function public.get_proposal_voting_summaries(_proposal_ids uuid[])
returns table (
  proposal_id uuid, author_name text, voting_open boolean, voting_started_at timestamptz,
  votes_for integer, votes_against integer, votes_abstaining integer, my_vote text,
  ballot_round integer, voters integer, eligible_voters integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  eligible integer;
begin
  if actor_id is null or not (select private.is_active_member()) then
    raise exception 'Active membership required.' using errcode = '42501';
  end if;
  if coalesce(cardinality(_proposal_ids), 0) > 50 then
    raise exception 'Too many proposal identifiers.' using errcode = '22023';
  end if;
  select count(*)::integer into eligible from public.memberships where membership_status = 'active';

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
    max(vote.vote_choice) filter (where vote.user_id = actor_id),
    proposal.ballot_round,
    case when proposal.voting_open and not coalesce(bool_or(vote.user_id = actor_id), false) then null
      else count(vote.user_id)::integer end,
    case when proposal.voting_open and not coalesce(bool_or(vote.user_id = actor_id), false) then null
      else eligible end
  from public.proposals as proposal
  left join public.profiles as profile on profile.id = proposal.created_by
  left join public.proposal_votes as vote on vote.proposal_id = proposal.id
  where proposal.id = any(coalesce(_proposal_ids, '{}'::uuid[]))
    and (
      proposal.created_by = actor_id
      or proposal.status in ('submitted', 'in_review', 'approved', 'rejected')
      or ((select private.has_any_role(array['coordinator', 'club_manager', 'admin'])) and proposal.status <> 'draft')
    )
  group by proposal.id, profile.display_name, proposal.voting_open, proposal.voting_started_at, proposal.ballot_round
  order by proposal.id;
end;
$$;

revoke all on function public.get_proposal_voting_summaries(uuid[]) from public, anon, authenticated;
grant execute on function public.get_proposal_voting_summaries(uuid[]) to authenticated;
revoke all on function public.start_proposal_runoff(uuid) from public, anon, authenticated;
grant execute on function public.start_proposal_runoff(uuid) to authenticated;
revoke all on function private.proposal_tally(uuid) from public, anon, authenticated;
revoke all on function private.actor_display_name() from public, anon, authenticated;
revoke all on function private.notify_users(uuid[], text, text) from public, anon, authenticated;
revoke all on function private.proposal_lifecycle() from public, anon, authenticated;
revoke all on function private.proposal_after_change() from public, anon, authenticated;
