begin;
select plan(6);

set local role anon;
select set_config('request.jwt.claim.role', 'anon', true);

select throws_ok($$
  insert into public.membership_applications (full_name, email, phone, motivation, consented_to_member_sharing)
  values ('Envio Directo', 'direct@example.org', '+1 809 555 0100', 'Intento de inserción directa sin pasar por el formulario.', true)
$$, '42501', null, 'direct REST-style INSERT is denied to anonymous clients');

select lives_ok($$
  select public.submit_membership_application('Persona Uno', 'uno@example.org', '+1 809 555 0101', 'Docente',
    'Me interesa colaborar con los proyectos de alfabetización.', 'Evento', true)
$$, 'the intake function accepts a valid application');

select throws_ok($$
  select public.submit_membership_application('Persona Uno', 'UNO@example.org ', '+1 809 555 0101', null,
    'Me interesa colaborar con los proyectos de alfabetización.', null, true)
$$, '23505', null, 'an open application with the same normalized email is rejected');

reset role;
-- Fill the hourly window with synthetic rows (rolled back below).
insert into public.membership_applications (full_name, email, phone, motivation, consented_to_member_sharing)
select 'Relleno ' || n, 'relleno' || n || '@example.org', '+1 809 555 0199',
       'Fila sintética para comprobar el límite de solicitudes.', true
from generate_series(1, 19) as n;

set local role anon;
select throws_ok($$
  select public.submit_membership_application('Persona Veintiuno', 'veintiuno@example.org', '+1 809 555 0121', null,
    'Me interesa colaborar con los proyectos de alfabetización.', null, true)
$$, 'PT429', null, 'the club-wide hourly limit stops a flood of applications');

reset role;
select is(
  (select count(*)::integer from public.membership_applications where email = 'veintiuno@example.org'),
  0,
  'the throttled application was not stored'
);
select is(
  (select consented_to_member_sharing from public.membership_applications where email = 'uno@example.org'),
  true,
  'stored applications always record consent'
);

select * from finish();
rollback;
