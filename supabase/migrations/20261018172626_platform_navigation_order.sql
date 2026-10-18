-- Shared navigation order: active members read; only administrators with recent MFA edit.
create table public.platform_navigation (
  id boolean primary key default true check (id),
  item_order text[] not null,
  revision integer not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint platform_navigation_complete_order check (
    array_ndims(item_order) = 1 and array_lower(item_order, 1) = 1
    and cardinality(item_order) = 11 and array_position(item_order, null) is null
    and item_order @> array['resumen','propuestas','agenda','actividades','finanzas','solicitudes','organizacion','revista','fotografias','auditoria','diagnostico']::text[]
    and item_order <@ array['resumen','propuestas','agenda','actividades','finanzas','solicitudes','organizacion','revista','fotografias','auditoria','diagnostico']::text[]
  )
);

insert into public.platform_navigation (item_order)
values (array['resumen','propuestas','agenda','actividades','finanzas','solicitudes','organizacion','revista','fotografias','auditoria','diagnostico']);

alter table public.platform_navigation enable row level security;
revoke all on public.platform_navigation from public, anon, authenticated;
grant select (id, item_order, revision), update (item_order) on public.platform_navigation to authenticated;

create policy platform_navigation_member_read on public.platform_navigation for select to authenticated
using ((select private.is_active_member()));
create policy platform_navigation_admin_update on public.platform_navigation for update to authenticated
using ((select private.has_any_role(array['admin'])))
with check ((select private.has_any_role(array['admin'])));

create function private.stamp_platform_navigation() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.item_order is not distinct from old.item_order then return old; end if;
  new.revision := old.revision + 1;
  new.updated_at := clock_timestamp();
  new.updated_by := auth.uid();
  return new;
end;
$$;
revoke all on function private.stamp_platform_navigation() from public, anon, authenticated, service_role;
create trigger platform_navigation_stamp before update on public.platform_navigation
for each row execute function private.stamp_platform_navigation();
create trigger zz_club_audit after insert or update or delete on public.platform_navigation
for each row execute function private.capture_club_audit_change('id');

comment on table public.platform_navigation is 'One shared platform menu. Admin-only updates, optimistic revision, no messages entry.';
notify pgrst, 'reload schema';
