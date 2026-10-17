-- Explicit product decision: recovery reports when an email is not registered.
-- Only a boolean is exposed. Auth users, IDs and metadata remain inaccessible.
-- The application calls the wrapper through its private server transport;
-- Cloudflare must continue to deny the public /rest/v1/rpc/* route.
create or replace function private.auth_recovery_email_exists(email_address text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(length(btrim(email_address)) between 3 and 254, false)
    and exists (
      select 1 from auth.users u
      where lower(u.email) = lower(btrim(email_address))
        and u.deleted_at is null
    );
$$;

revoke all on function private.auth_recovery_email_exists(text) from public, anon, authenticated;
grant execute on function private.auth_recovery_email_exists(text) to anon, authenticated;

create or replace function public.auth_recovery_email_exists(email_address text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$ select private.auth_recovery_email_exists(email_address); $$;

revoke all on function public.auth_recovery_email_exists(text) from public, anon, authenticated;
grant execute on function public.auth_recovery_email_exists(text) to anon, authenticated;
