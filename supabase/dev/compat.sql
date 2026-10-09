-- =============================================================================
-- NUR für den lokalen Demo-Modus und die Tests (PGlite im Browser / Node).
-- NICHT in Supabase ausführen – dort gibt es das alles schon.
--
-- Bildet das Nötigste von Supabase nach: Rollen (anon, authenticated,
-- service_role), das Schema "auth" mit auth.users und auth.uid().
-- =============================================================================
create schema if not exists auth;

create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text not null unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

-- Demo-Passwörter (SHA-256), damit sich Login und Registrierung echt anfühlen.
create table if not exists auth.dev_passwords (
  user_id uuid primary key references auth.users(id) on delete cascade,
  hash    text not null
);
create table if not exists auth.dev_meta (k text primary key, v text);

-- Wie bei Supabase: die Benutzer-ID steht im JWT ("request.jwt.claims").
create or replace function auth.uid() returns uuid
language sql stable as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
$$;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

grant usage on schema public, auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
-- Supabase vergibt standardmässig alle Rechte an diese Rollen; die Regeln
-- (Row Level Security) entscheiden. Das Schema nimmt dann gezielt zurück.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
