-- Requested management examples. Fictitious members cannot sign in.
-- Ledger examples use January 2000 and do not affect the current financial month.
begin;
do $$
declare manager uuid;
  ana constant uuid := '10000000-0000-4000-8000-000000000001';
  luis constant uuid := '10000000-0000-4000-8000-000000000002';
  carla constant uuid := '10000000-0000-4000-8000-000000000003';
  activity constant uuid := '10000000-0000-4000-8000-000000000010';
  due uuid;
begin
  select user_id into manager from public.memberships where membership_role='admin' and membership_status='active' order by created_at limit 1;
  if manager is null then raise exception 'An active administrator is required'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', manager, 'role','authenticated')::text,true);
  if exists(select 1 from auth.users where id in(ana,luis,carla) and email not like '%@club-ui-demo.invalid') then raise exception 'Fixture UUID belongs to another account'; end if;
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,banned_until,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values
    (ana,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','ana@club-ui-demo.invalid','',now(),'infinity','{}','{"display_name":"Prueba · Ana Rivera"}',now(),now()),
    (luis,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','luis@club-ui-demo.invalid','',now(),'infinity','{}','{"display_name":"Prueba · Luis Méndez"}',now(),now()),
    (carla,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','carla@club-ui-demo.invalid','',now(),'infinity','{}','{"display_name":"Prueba · Carla Santos"}',now(),now())
  on conflict(id) do nothing;
  update public.memberships set membership_status='active', notes='Datos ficticios para verificar gestión. Cuenta de prueba sin acceso de inicio de sesión.', approved_by=manager, approved_at=now(), joined_at=coalesce(joined_at,now()) where user_id in(ana,luis,carla) and membership_status='pending';
  insert into public.activities(id,title,slug,description,activity_status,starts_at,ends_at,location,lead_id,created_by)
  values(activity,'Jornada de servicio · Prueba','jornada-servicio-prueba','Actividad ficticia para probar tareas, aportes y gastos. Ejemplo contable del período enero 2000.','completed','2000-01-15 09:00:00-04','2000-01-15 13:00:00-04','Lugar de prueba',ana,manager)
  on conflict(id) do nothing;
  insert into public.tasks(id,activity_id,title,description,task_status,assignee_id,completed_at,created_by)
  values('10000000-0000-4000-8000-000000000011',activity,'Preparar materiales · Prueba','Tarea ficticia completada para revisar responsables e historial.','done',ana,now(),manager)
  on conflict(id) do nothing;
  perform public.create_finance_member_dues('2000-01-01',500,array[ana,luis]);
  perform public.create_finance_member_dues('2000-01-01',350,array[carla]);
  select id into due from public.finance_monthly_dues where member_id=ana and due_month='2000-01-01';
  if not exists(select 1 from public.finance_entries where receipt_reference='DEMO-ANA-CUOTA') then
    perform public.record_finance_monthly_payment(due,500,'2000-01-05','cash','DEMO-ANA-CUOTA');
  end if;
  select id into due from public.finance_monthly_dues where member_id=luis and due_month='2000-01-01';
  if not exists(select 1 from public.finance_entries where receipt_reference='DEMO-LUIS-PARCIAL') then
    perform public.record_finance_monthly_payment(due,200,'2000-01-05','bank_transfer','DEMO-LUIS-PARCIAL');
  end if;
  if not exists(select 1 from public.finance_entries where receipt_reference='DEMO-ANA-ACTIVIDAD') then
    perform public.create_finance_entry('income','activity_contribution',800,'2000-01-10','Aporte para materiales · Prueba',ana,null,activity,'cash','DEMO-ANA-ACTIVIDAD');
    perform public.create_finance_entry('income','donation',400,'2000-01-11','Donación para jornada · Prueba',null,'Donante ficticio',activity,'cash','DEMO-DONACION');
    perform public.create_finance_entry('expense','activity_expense',650,'2000-01-15','Compra de materiales · Prueba',carla,'Proveedor ficticio',activity,'cash','DEMO-GASTO');
  end if;
end;
$$;
commit;
select jsonb_build_object('demo_members',(select count(*) from auth.users where email like '%@club-ui-demo.invalid' and banned_until='infinity'), 'dues',(select count(*) from public.finance_monthly_dues where due_month='2000-01-01'), 'demo_entries',(select count(*) from public.finance_entries where receipt_reference like 'DEMO-%'), 'current_month_entries',(select count(*) from public.finance_entries where occurred_on >= date_trunc('month',now() at time zone 'America/Santo_Domingo')::date)) as demo_result;
