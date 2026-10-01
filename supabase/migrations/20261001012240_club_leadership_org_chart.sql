-- Organizational responsibilities are independent of application access roles.
create table public.club_leadership_terms (
  id uuid primary key default gen_random_uuid(),
  start_year integer not null unique check (start_year between 1970 and 2200),
  label text not null default '' check (char_length(label) <= 120),
  is_locked boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.club_leadership_positions (
  id uuid primary key default gen_random_uuid(),
  term_id uuid not null references public.club_leadership_terms(id),
  title text not null check (char_length(btrim(title)) between 2 and 100),
  responsibilities text not null default '' check (char_length(responsibilities) <= 1200),
  parent_id uuid,
  member_id uuid references public.profiles(id) on delete set null,
  member_name_snapshot text,
  sort_order integer not null default 0 check (sort_order between 0 and 999),
  is_active boolean not null default true,
  access_role text not null default 'member' check (access_role in ('member', 'coordinator', 'editor', 'club_manager', 'admin')),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, term_id),
  foreign key (parent_id, term_id) references public.club_leadership_positions(id, term_id),
  check (parent_id is distinct from id)
);
create index club_leadership_positions_term_idx on public.club_leadership_positions(term_id, sort_order, id);
create index club_leadership_positions_parent_idx on public.club_leadership_positions(parent_id, term_id);
create index club_leadership_positions_member_idx on public.club_leadership_positions(member_id) where member_id is not null;
create unique index club_leadership_positions_title_idx on public.club_leadership_positions(term_id, lower(btrim(title))) where is_active;

alter table public.club_leadership_terms enable row level security;
alter table public.club_leadership_positions enable row level security;
revoke all on public.club_leadership_terms, public.club_leadership_positions from public, anon, authenticated;
grant select, insert, update on public.club_leadership_terms, public.club_leadership_positions to authenticated;
grant all on public.club_leadership_terms, public.club_leadership_positions to service_role;
create policy leadership_terms_read on public.club_leadership_terms for select to authenticated using ((select private.is_active_member()));
create policy leadership_terms_insert on public.club_leadership_terms for insert to authenticated with check ((select private.has_any_role(array['admin'])));
create policy leadership_terms_update on public.club_leadership_terms for update to authenticated using ((select private.has_any_role(array['admin']))) with check ((select private.has_any_role(array['admin'])));
create policy leadership_positions_read on public.club_leadership_positions for select to authenticated using ((select private.is_active_member()));
create policy leadership_positions_insert on public.club_leadership_positions for insert to authenticated with check ((select private.has_any_role(array['admin'])));
create policy leadership_positions_update on public.club_leadership_positions for update to authenticated using ((select private.has_any_role(array['admin']))) with check ((select private.has_any_role(array['admin'])));

create function private.validate_leadership_term()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.start_year is distinct from old.start_year then
    raise exception 'The Rotary year cannot be changed.' using errcode = '22023';
  end if;
  new.created_by := case when tg_op = 'INSERT' then auth.uid() else old.created_by end;
  new.updated_by := auth.uid();
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create function private.validate_leadership_position()
returns trigger language plpgsql set search_path = '' as $$
declare locked boolean; selected_name text;
begin
  -- Serialize mutations within a year so concurrent parent changes cannot form a cycle.
  select is_locked into locked from public.club_leadership_terms where id = new.term_id for update;
  if not found then raise exception 'The Rotary year is unavailable.' using errcode = '22023'; end if;
  if locked then raise exception 'This Rotary year is closed.' using errcode = '22023'; end if;
  if tg_op = 'UPDATE' and new.term_id is distinct from old.term_id then
    raise exception 'Positions cannot move between Rotary years.' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' and (select count(*) from public.club_leadership_positions where term_id = new.term_id) >= 60 then
    raise exception 'A Rotary year supports at most 60 positions.' using errcode = '22023';
  end if;
  if new.parent_id is not null then
    if not exists (select 1 from public.club_leadership_positions where id = new.parent_id and term_id = new.term_id and is_active) then
      raise exception 'Choose an active position in the same Rotary year.' using errcode = '22023';
    end if;
    if exists (
      with recursive ancestors as (
        select id, parent_id from public.club_leadership_positions where id = new.parent_id and term_id = new.term_id
        union
        select position.id, position.parent_id from public.club_leadership_positions position join ancestors on position.id = ancestors.parent_id where position.term_id = new.term_id
      ) select 1 from ancestors where id = new.id
    ) then raise exception 'The hierarchy cannot contain a cycle.' using errcode = '22023'; end if;
  end if;
  if not new.is_active and exists (select 1 from public.club_leadership_positions where parent_id = new.id and is_active) then
    raise exception 'Move subordinate positions before archiving their parent.' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' or new.member_id is distinct from old.member_id then
    if new.member_id is null then new.member_name_snapshot := null;
    else
      select profile.display_name into selected_name from public.profiles profile join public.memberships membership on membership.user_id = profile.id
      where profile.id = new.member_id and membership.membership_status = 'active';
      if not found then raise exception 'Only active members can receive a position.' using errcode = '22023'; end if;
      new.member_name_snapshot := coalesce(nullif(selected_name, ''), 'Miembro sin nombre');
    end if;
  else new.member_name_snapshot := old.member_name_snapshot;
  end if;
  new.title := btrim(new.title);
  new.responsibilities := btrim(new.responsibilities);
  new.created_by := case when tg_op = 'INSERT' then auth.uid() else old.created_by end;
  new.updated_by := auth.uid();
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function private.validate_leadership_term(), private.validate_leadership_position() from public, anon, authenticated, service_role;
create trigger leadership_term_validate before insert or update on public.club_leadership_terms for each row execute function private.validate_leadership_term();
create trigger leadership_position_validate before insert or update on public.club_leadership_positions for each row execute function private.validate_leadership_position();
create trigger zz_club_audit after insert or update or delete on public.club_leadership_terms for each row execute function private.capture_club_audit_change('id');
create trigger zz_club_audit after insert or update or delete on public.club_leadership_positions for each row execute function private.capture_club_audit_change('id');

create function public.create_club_leadership_term(_start_year integer, _label text default '', _template_term_id uuid default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare term uuid; president uuid; item record; ids jsonb := '{}'::jsonb; position uuid;
begin
  if auth.uid() is null or not private.has_any_role(array['admin']) then raise exception 'Only an active administrator can define club leadership.' using errcode = '42501'; end if;
  if _start_year is null or _start_year not between 1970 and 2200 or char_length(coalesce(_label, '')) > 120 then raise exception 'The Rotary year is invalid.' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(92601, _start_year);
  select id into term from public.club_leadership_terms where start_year = _start_year;
  if found then return term; end if;
  if _template_term_id is not null and not exists (select 1 from public.club_leadership_terms where id = _template_term_id) then raise exception 'The template is unavailable.' using errcode = '22023'; end if;
  insert into public.club_leadership_terms(start_year, label) values (_start_year, btrim(coalesce(_label, ''))) returning id into term;
  if _template_term_id is not null then
    for item in select * from public.club_leadership_positions where term_id = _template_term_id and is_active order by sort_order, id loop
      insert into public.club_leadership_positions(term_id, title, responsibilities, sort_order, access_role) values (term, item.title, item.responsibilities, item.sort_order, item.access_role) returning id into position;
      ids := ids || jsonb_build_object(item.id::text, position);
    end loop;
    for item in select id, parent_id from public.club_leadership_positions where term_id = _template_term_id and is_active and parent_id is not null loop
      update public.club_leadership_positions set parent_id = (ids->>item.parent_id::text)::uuid where id = (ids->>item.id::text)::uuid;
    end loop;
  else
    insert into public.club_leadership_positions(term_id, title, responsibilities, sort_order) values (term, 'Presidencia', 'Encabeza la directiva y coordina el trabajo del club.', 0) returning id into president;
    insert into public.club_leadership_positions(term_id, title, responsibilities, parent_id, sort_order) values
      (term, 'Vicepresidencia', 'Apoya a la presidencia y asume sus funciones cuando corresponde.', president, 10),
      (term, 'Secretaría', 'Mantiene actas, comunicaciones y registros del club.', president, 20),
      (term, 'Tesorería', 'Da seguimiento a ingresos, egresos y cuentas del club.', president, 30);
    insert into public.club_leadership_positions(term_id, title, responsibilities, parent_id, sort_order) values
      (term, 'Presidencia electa', 'Prepara el siguiente período de liderazgo.', president, 40),
      (term, 'Presidencia anterior', 'Aporta continuidad y acompaña a la directiva.', president, 50),
      (term, 'Macero', 'Apoya el protocolo y el orden de las reuniones.', president, 60);
  end if;
  return term;
end;
$$;
revoke all on function public.create_club_leadership_term(integer, text, uuid) from public, anon, authenticated;
grant execute on function public.create_club_leadership_term(integer, text, uuid) to authenticated;

-- Applying a position's configured access is an explicit, atomic admin operation.
-- Merely assigning a Rotary title never grants application privileges.
create function public.save_club_leadership_position(
  _position_id uuid, _term_id uuid, _title text, _responsibilities text, _parent_id uuid,
  _member_id uuid, _sort_order integer, _is_active boolean, _access_role text,
  _apply_access boolean, _expected_updated_at timestamptz
)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare position uuid; term_year integer; term_locked boolean; current_role text; rotary_year integer;
begin
  if auth.uid() is null or not private.has_any_role(array['admin']) then raise exception 'Only an active administrator can define club leadership.' using errcode = '42501'; end if;
  if _access_role is null or _access_role not in ('member', 'coordinator', 'editor', 'club_manager', 'admin') or _apply_access is null then raise exception 'The access level is invalid.' using errcode = '22023'; end if;
  select start_year, is_locked into term_year, term_locked from public.club_leadership_terms where id = _term_id for update;
  if not found then raise exception 'The Rotary year is unavailable.' using errcode = '22023'; end if;
  if term_locked then raise exception 'This Rotary year is closed.' using errcode = '22023'; end if;
  if _apply_access then
    rotary_year := extract(year from now() at time zone 'America/Santo_Domingo')::integer - case when extract(month from now() at time zone 'America/Santo_Domingo') < 7 then 1 else 0 end;
    if term_year <> rotary_year or not _is_active then raise exception 'Access can only be applied from an active position in the current Rotary year.' using errcode = '22023'; end if;
    select membership_role into current_role from public.memberships where user_id = _member_id and membership_status = 'active' for update;
    if not found then raise exception 'Only active members can receive a position.' using errcode = '22023'; end if;
    if _member_id = auth.uid() and _access_role <> current_role then raise exception 'An administrator cannot change their own access.' using errcode = '42501'; end if;
  end if;
  if _position_id is null then
    insert into public.club_leadership_positions(term_id, title, responsibilities, parent_id, member_id, sort_order, is_active, access_role)
    values (_term_id, _title, coalesce(_responsibilities, ''), _parent_id, _member_id, _sort_order, _is_active, _access_role) returning id into position;
  else
    if _expected_updated_at is null then raise exception 'Reload the position before saving.' using errcode = '40001'; end if;
    update public.club_leadership_positions set title = _title, responsibilities = coalesce(_responsibilities, ''), parent_id = _parent_id,
      member_id = _member_id, sort_order = _sort_order, is_active = _is_active, access_role = _access_role
      where id = _position_id and term_id = _term_id and updated_at = _expected_updated_at returning id into position;
    if not found then raise exception 'The position changed while editing.' using errcode = '40001'; end if;
  end if;
  if _apply_access and _access_role <> current_role then
    update public.memberships set membership_role = _access_role where user_id = _member_id;
  end if;
  return position;
end;
$$;
revoke all on function public.save_club_leadership_position(uuid, uuid, text, text, uuid, uuid, integer, boolean, text, boolean, timestamptz) from public, anon, authenticated;
grant execute on function public.save_club_leadership_position(uuid, uuid, text, text, uuid, uuid, integer, boolean, text, boolean, timestamptz) to authenticated;
