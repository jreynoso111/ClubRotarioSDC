-- Minimal Supabase-compatible stub for offline migration tests in CI. Never apply to a real backend.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create role authenticator noinherit login; grant anon, authenticated, service_role to authenticator;
    create role supabase_admin superuser; create role supabase_storage_admin; create role supabase_auth_admin;
  end if; end $$;
create schema auth; create schema storage; create schema extensions;
create extension pgcrypto with schema extensions;
create extension "uuid-ossp" with schema extensions;
alter database postgres set search_path = "$user", public, extensions;
grant usage on schema auth, storage, extensions to anon, authenticated, service_role;
create table auth.users (
  instance_id uuid, id uuid primary key, aud varchar(255), role varchar(255), email varchar(255),
  encrypted_password varchar(255), email_confirmed_at timestamptz, invited_at timestamptz,
  confirmation_token varchar(255), recovery_token varchar(255), last_sign_in_at timestamptz,
  raw_app_meta_data jsonb, raw_user_meta_data jsonb, is_super_admin boolean,
  created_at timestamptz default now(), updated_at timestamptz default now(), phone text,
  banned_until timestamptz, deleted_at timestamptz, is_sso_user boolean default false, is_anonymous boolean default false);
create table auth.sessions (id uuid primary key, user_id uuid references auth.users on delete cascade,
  created_at timestamptz default now(), updated_at timestamptz default now(), factor_id uuid, aal text,
  not_after timestamptz, refreshed_at timestamp, user_agent text, ip inet, tag text, refresh_token_hmac_key text);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
create function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text $$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), ''))::jsonb $$;
grant execute on all functions in schema auth to anon, authenticated, service_role;
create table storage.buckets (id text primary key, name text not null, owner uuid, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now(), updated_at timestamptz default now());
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets,
  name text, owner uuid, owner_id text, metadata jsonb, user_metadata jsonb, version text,
  created_at timestamptz default now(), updated_at timestamptz default now(), last_accessed_at timestamptz default now(),
  path_tokens text[] generated always as (string_to_array(name, '/')) stored);
alter table storage.objects enable row level security;
alter table storage.buckets enable row level security;
grant all on storage.objects, storage.buckets to anon, authenticated, service_role;
create function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare _parts text[]; begin select string_to_array(name, '/') into _parts; return _parts[1:array_length(_parts,1)-1]; end $$;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
