-- Tiny pgTAP-compatible shim: plan/ok/is/isnt/lives_ok/throws_ok/finish.
create schema if not exists tap;
create table if not exists tap.results (n serial, ok boolean, descr text);
grant usage on schema tap to public; grant all on tap.results to public; grant usage on sequence tap.results_n_seq to public;
create or replace function public.plan(n int) returns text language sql as $$ select '1..' || n $$;
create or replace function public.ok(b boolean, d text default '') returns text language plpgsql as $$
begin insert into tap.results(ok, descr) values (coalesce(b,false), d);
 if not coalesce(b,false) then raise warning 'NOT OK: %', d; end if; return (case when b then 'ok ' else 'not ok ' end) || d; end $$;
create or replace function public.is(a anyelement, b anyelement, d text default '') returns text language sql as $$ select public.ok(a is not distinct from b, d || case when a is distinct from b then format(' (got %s expected %s)', a, b) else '' end) $$;
create or replace function public.isnt(a anyelement, b anyelement, d text default '') returns text language sql as $$ select public.ok(a is distinct from b, d) $$;
create or replace function public.lives_ok(q text, d text default '') returns text language plpgsql as $$
begin execute q; return public.ok(true, d); exception when others then return public.ok(false, d || ' :: ' || sqlerrm); end $$;
create or replace function public.throws_ok(q text, e text, m text default null, d text default '') returns text language plpgsql as $$
begin execute q; return public.ok(false, coalesce(d, m, '') || ' (no exception)');
exception when others then return public.ok(sqlstate = e or sqlerrm = e or (length(e) <> 5 and sqlerrm like '%'||e||'%'), coalesce(d, m, '') || format(' [%s %s]', sqlstate, sqlerrm)); end $$;
create or replace function public.throws_ok(q text, e text) returns text language sql as $$ select public.throws_ok(q, e, null, '') $$;
create or replace function public.throws_ok(q text) returns text language plpgsql as $$
begin execute q; return public.ok(false, 'expected exception'); exception when others then return public.ok(true, 'threw ' || sqlstate); end $$;
create or replace function public.finish() returns setof text language sql as $$ select format('# %s/%s passed', count(*) filter (where ok), count(*)) from tap.results $$;
-- shim functions keep default PUBLIC execute
