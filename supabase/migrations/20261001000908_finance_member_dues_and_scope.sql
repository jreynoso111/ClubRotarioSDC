-- Individually selected monthly obligations. Existing batch RPC remains compatible.
create function public.create_finance_member_dues(_due_month date, _amount_due numeric, _member_ids uuid[])
returns integer language plpgsql security definer set search_path = '' as $$
declare inserted_count integer;
begin
  perform private.assert_finance_manager();
  if _due_month is null or extract(day from _due_month) <> 1
    or _amount_due is null or _amount_due <= 0 or _amount_due > 9999999999.99
    or trunc(_amount_due, 2) <> _amount_due
    or coalesce(cardinality(_member_ids), 0) not between 1 and 200
    or exists (select 1 from unnest(_member_ids) selected(id) where id is null
      or not exists(select 1 from public.memberships m where m.user_id = selected.id and m.membership_status = 'active')) then
    raise exception 'Invalid members, period or amount.' using errcode = '22023';
  end if;
  insert into public.finance_monthly_dues(due_month, member_id, member_name_snapshot, amount_due, created_by)
  select _due_month, m.user_id, coalesce(nullif(btrim(p.display_name), ''), 'Miembro del club'), _amount_due, auth.uid()
  from public.memberships m join public.profiles p on p.id=m.user_id
  where m.user_id=any(_member_ids) and m.membership_status='active'
  on conflict(member_id,due_month) do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;
revoke all on function public.create_finance_member_dues(date,numeric,uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.create_finance_member_dues(date,numeric,uuid[]) to authenticated;

-- Aggregates cover the full filtered period, independently of ledger pagination.
create function public.get_finance_scope_totals(_month_start date, _member_id uuid default null, _activity_id uuid default null)
returns table(income_total numeric,expense_total numeric,entry_count bigint)
language sql stable security invoker set search_path = '' as $$
  select coalesce(sum(amount) filter(where direction='income'),0),
    coalesce(sum(amount) filter(where direction='expense'),0), count(*)
  from public.finance_entries
  where (select private.is_active_member())
    and occurred_on >= _month_start and occurred_on < (_month_start + interval '1 month')::date
    and (_member_id is null or member_id=_member_id)
    and (_activity_id is null or activity_id=_activity_id);
$$;
revoke all on function public.get_finance_scope_totals(date,uuid,uuid) from public,anon;
grant execute on function public.get_finance_scope_totals(date,uuid,uuid) to authenticated;
notify pgrst, 'reload schema';
