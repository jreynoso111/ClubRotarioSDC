-- H08: public membership applications no longer accept direct table INSERTs
-- through the REST API. Intake goes through one function that validates
-- consent and applies a club-wide throttle in the database, so a client that
-- bypasses the web form (and its CAPTCHA and per-network limits) cannot flood
-- the review queue. The function is reachable only from the Next server: the
-- public tunnel does not route /rest/v1/rpc/*.

drop policy if exists membership_applications_submit on public.membership_applications;
revoke insert on public.membership_applications from public, anon, authenticated;

create or replace function public.submit_membership_application(
  _full_name text,
  _email text,
  _phone text,
  _occupation text,
  _motivation text,
  _referral_source text,
  _consent boolean
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if _consent is distinct from true then
    raise exception 'Member-sharing consent is required.' using errcode = '42501';
  end if;

  -- Serialize intake so the counters below cannot be raced by parallel requests.
  perform pg_advisory_xact_lock(hashtext('public.submit_membership_application'));
  if (select count(*) from public.membership_applications
      where submitted_at > now() - interval '1 hour') >= 20
    or (select count(*) from public.membership_applications
      where submitted_at > now() - interval '1 day') >= 100 then
    -- PostgREST maps PTxxx to that HTTP status.
    raise exception 'application_rate_limited' using errcode = 'PT429';
  end if;

  insert into public.membership_applications (
    full_name, email, phone, occupation, motivation, referral_source, consented_to_member_sharing
  ) values (
    btrim(_full_name), lower(btrim(_email)), btrim(_phone), nullif(btrim(_occupation), ''),
    btrim(_motivation), nullif(btrim(_referral_source), ''), true
  );
end;
$$;

revoke all on function public.submit_membership_application(text, text, text, text, text, text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.submit_membership_application(text, text, text, text, text, text, boolean)
  to anon, authenticated;
