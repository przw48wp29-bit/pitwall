-- =============================================================================
-- Pitwall Tippspiel – Datenbank, Stufen A + B
-- (Konten, Gruppen, Einladungen, Tipps mit Tippschluss; Resultate, Punkte,
--  Fahrer des Tages, Korrekturen, Ranglisten)
--
-- Einrichtung: Supabase → SQL Editor → New query → diese Datei komplett
-- einfügen → Run. Das Skript lässt sich gefahrlos mehrmals ausführen.
--
-- Grundsätze:
--   * Alle Zeiten werden in UTC gespeichert (timestamptz), angezeigt wird
--     im Browser in Zürcher Zeit.
--   * Tippschluss, Rechte und Sichtbarkeit erzwingt die Datenbank selbst
--     (Row Level Security + Prüf-Trigger). Das Frontend ist nur Komfort.
--   * Rennwochenenden und Fahrer schreibt ausschliesslich der Sync-Job
--     (GitHub Action mit Service-Key), nie ein Browser.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tabellen
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 30),
  avatar       jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create table if not exists public.groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 2 and 40),
  invite_code text not null unique,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists public.memberships (
  group_id  uuid not null references public.groups(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  role      text not null default 'member' check (role in ('admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists memberships_user_idx on public.memberships(user_id);

-- Einstellungen pro Gruppe und Saison (Punktesystem, Tippschluss, Joker …).
-- Eine neue Saison übernimmt automatisch die Einstellungen der letzten.
create table if not exists public.group_seasons (
  group_id   uuid not null references public.groups(id) on delete cascade,
  season     int  not null,
  status     text not null default 'running' check (status in ('open', 'running', 'closed')),
  settings   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  closed_at  timestamptz,
  primary key (group_id, season)
);

-- Rennwochenenden (aus Jolpica, geschrieben vom Sync-Job). id = 'JJJJ-RR'.
create table if not exists public.events (
  id                 text primary key check (id ~ '^\d{4}-\d{2}$'),
  season             int  not null,
  round              int  not null,
  name               text not null,
  circuit_id         text,
  country            text,
  quali_start        timestamptz not null,
  sprint_quali_start timestamptz,
  sprint_start       timestamptz,
  race_start         timestamptz not null,
  status             text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  results            jsonb,
  results_hash       text,
  results_at         timestamptz,
  updated_at         timestamptz not null default now(),
  unique (season, round)
);

-- Fahrerfeld pro Saison (für die Prüfung: nur aktuelle Fahrer wählbar).
create table if not exists public.season_drivers (
  season      int  not null,
  driver_id   text not null,
  code        text,
  given_name  text not null,
  family_name text not null,
  team_id     text,
  number      text,
  active      boolean not null default true,
  primary key (season, driver_id)
);

-- Tipps: pro Gruppe, Spieler, Wochenende und Art.
--   quali  {"order": [P1, P2, P3]}      P1 = Pole
--   sprint {"order": [P1, P2, P3]}
--   race   {"order": [P1 … P10]}         P1–P3 = Podium
--   extras {"fastest", "dotd", "sc", "dnf", "firstDnf"}
create table if not exists public.tips (
  group_id   uuid not null,
  user_id    uuid not null,
  event_id   text not null references public.events(id) on delete cascade,
  kind       text not null check (kind in ('quali', 'sprint', 'race', 'extras')),
  picks      jsonb not null,
  source     text not null default 'user' check (source in ('user', 'auto')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (group_id, user_id, event_id, kind),
  foreign key (group_id, user_id) references public.memberships(group_id, user_id) on delete cascade
);
create index if not exists tips_event_idx on public.tips(group_id, event_id);

-- Punkte pro Spieler, Gruppe und Wochenende (berechnet von score_group_event,
-- nie von Hand). detail = Aufschlüsselung pro Tipp-Art.
create table if not exists public.scores (
  group_id    uuid not null,
  user_id     uuid not null,
  event_id    text not null references public.events(id) on delete cascade,
  points      int  not null default 0,
  exact       int  not null default 0,
  detail      jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now(),
  primary key (group_id, user_id, event_id),
  foreign key (group_id, user_id) references public.memberships(group_id, user_id) on delete cascade
);

-- Angaben pro Gruppe und Wochenende, die es nicht frei im Netz gibt
-- (Fahrer des Tages trägt der Admin ein).
create table if not exists public.group_events (
  group_id   uuid not null references public.groups(id) on delete cascade,
  event_id   text not null references public.events(id) on delete cascade,
  dotd       text,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (group_id, event_id)
);

-- Manuelle Punktekorrekturen durch Admins, immer mit Begründung.
create table if not exists public.adjustments (
  id         bigint generated always as identity primary key,
  group_id   uuid not null,
  user_id    uuid not null,
  event_id   text references public.events(id) on delete set null,
  season     int  not null,
  points     int  not null check (points between -100 and 100 and points <> 0),
  reason     text not null check (char_length(btrim(reason)) between 2 and 120),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (group_id, user_id) references public.memberships(group_id, user_id) on delete cascade
);
create index if not exists adjustments_group_idx on public.adjustments(group_id, season);

-- -----------------------------------------------------------------------------
-- Hilfsfunktionen
-- -----------------------------------------------------------------------------
create or replace function public.require_user() returns uuid
language plpgsql stable set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Bitte zuerst anmelden.' using errcode = '28000'; end if;
  return auth.uid();
end $$;

create or replace function public.is_member(p_group uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships where group_id = p_group and user_id = auth.uid())
$$;

create or replace function public.is_admin(p_group uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships where group_id = p_group and user_id = auth.uid() and role = 'admin')
$$;

create or replace function public.shares_group(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships a join public.memberships b on a.group_id = b.group_id
    where a.user_id = auth.uid() and b.user_id = p_user)
$$;

-- Laufende Saison: die des nächsten Rennens, sonst die zuletzt bekannte.
create or replace function public.current_season() returns int
language sql stable set search_path = '' as $$
  select coalesce(
    (select season from public.events where race_start > now() - interval '2 days' and status = 'scheduled' order by race_start limit 1),
    (select max(season) from public.events),
    extract(year from now())::int)
$$;

create or replace function public.default_settings() returns jsonb
language sql immutable as $$
  select '{"preset": "standard", "lock": "early", "missing": "carry", "jokers": 3}'::jsonb
$$;

create or replace function public.valid_settings(s jsonb) returns boolean
language sql immutable as $$
  select jsonb_typeof(s) = 'object'
     and coalesce(s->>'lock', 'early') in ('early', 'late')
     and coalesce(s->>'missing', 'carry') in ('carry', 'zero')
     and coalesce(s->>'preset', 'standard') in ('einfach', 'standard', 'profi', 'eigene')
     and (s->'jokers' is null or (jsonb_typeof(s->'jokers') = 'number' and (s->>'jokers')::numeric between 0 and 10))
$$;

-- Einstellungen einer Gruppe für eine Saison (mit Vorgaben aufgefüllt).
create or replace function public.group_settings(p_group uuid, p_season int) returns jsonb
language sql stable security definer set search_path = '' as $$
  select public.default_settings() || coalesce(
    (select settings from public.group_seasons where group_id = p_group and season <= p_season order by season desc limit 1),
    (select settings from public.group_seasons where group_id = p_group order by season limit 1),
    '{}'::jsonb)
$$;

-- Punktwerte der Vorlagen (siehe docs/tippspiel-konzept.md). Ein Wert 0 heisst:
-- dieser Tipp zählt in der Vorlage nicht.
--   quali:  pole = P1 exakt, exact = P2/P3 exakt, inTop = in den Top 3, falscher Platz, bonus = alle 3 exakt
--   sprint: exact, inTop, bonus
--   race:   podium = P1–P3 exakt, podiumIn = aufs Podium getippt und dort, falscher Platz,
--           exact = P4–P10 exakt, near = P4–P10 einen Platz daneben, inTop = in den Top 10, falscher Platz,
--           bonusPodium = Podium komplett exakt, bonusTop10 = alle 10 exakt
--   extras: fastest, dotd, scYes (SC ja/nein richtig), sc (Anzahl exakt), dnf (Ausfälle exakt),
--           dnfNear (±1), firstDnf
--   outsider: few = exakter Treffer, den höchstens 25 % der Tipper haben, alone = als Einziger
create or replace function public.points_preset(p_preset text) returns jsonb
language sql immutable as $$
  select case p_preset
    when 'einfach' then '{
      "quali":  {"pole": 3, "exact": 0, "inTop": 0, "bonus": 0},
      "sprint": {"exact": 0, "inTop": 0, "bonus": 0},
      "race":   {"podium": 3, "podiumIn": 1, "exact": 0, "near": 0, "inTop": 0, "bonusPodium": 3, "bonusTop10": 0},
      "extras": {"fastest": 2, "dotd": 0, "scYes": 0, "sc": 0, "dnf": 0, "dnfNear": 0, "firstDnf": 0},
      "outsider": {"few": 0, "alone": 0}}'::jsonb
    when 'profi' then '{
      "quali":  {"pole": 5, "exact": 3, "inTop": 1, "bonus": 3},
      "sprint": {"exact": 3, "inTop": 1, "bonus": 0},
      "race":   {"podium": 6, "podiumIn": 2, "exact": 3, "near": 2, "inTop": 1, "bonusPodium": 5, "bonusTop10": 20},
      "extras": {"fastest": 2, "dotd": 2, "scYes": 1, "sc": 3, "dnf": 3, "dnfNear": 1, "firstDnf": 4},
      "outsider": {"few": 2, "alone": 4}}'::jsonb
    else '{
      "quali":  {"pole": 4, "exact": 3, "inTop": 1, "bonus": 3},
      "sprint": {"exact": 3, "inTop": 1, "bonus": 0},
      "race":   {"podium": 5, "podiumIn": 2, "exact": 2, "near": 0, "inTop": 1, "bonusPodium": 5, "bonusTop10": 10},
      "extras": {"fastest": 2, "dotd": 2, "scYes": 1, "sc": 2, "dnf": 3, "dnfNear": 1, "firstDnf": 3},
      "outsider": {"few": 1, "alone": 2}}'::jsonb
  end
$$;

-- Tippschluss pro Gruppe, Wochenende und Tipp-Art.
--   früh («early», Standard): Quali-, Renn- und Zusatztipps beim Qualifying-Start,
--                              Sprint-Tipps beim Sprint-Qualifying-Start.
--   spät («late»):            Quali beim Qualifying-Start, Rennen + Zusatz beim
--                              Rennstart, Sprint beim Sprintstart.
create or replace function public.lock_time(p_group uuid, p_event text, p_kind text) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select case p_kind
    when 'quali'  then e.quali_start
    when 'sprint' then case when s->>'lock' = 'late' then e.sprint_start else coalesce(e.sprint_quali_start, e.sprint_start) end
    when 'race'   then case when s->>'lock' = 'late' then e.race_start else e.quali_start end
    when 'extras' then case when s->>'lock' = 'late' then e.race_start else e.quali_start end
  end
  from public.events e, lateral (select public.group_settings(p_group, e.season) as s) x
  where e.id = p_event
$$;

create or replace function public.tip_open(p_group uuid, p_event text, p_kind text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select e.status = 'scheduled' and now() < public.lock_time(p_group, p_event, p_kind)
    from public.events e where e.id = p_event), false)
$$;

create or replace function public.new_invite_code() returns text
language sql volatile set search_path = '' as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (get_byte(uuid_send(gen_random_uuid()), 0) % 32) + 1, 1), '')
  from generate_series(1, 8)
$$;

-- -----------------------------------------------------------------------------
-- Prüfungen (Trigger)
-- -----------------------------------------------------------------------------
-- Neues Konto → Profil anlegen (Name aus der Registrierung).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(nullif(btrim(new.raw_user_meta_data->>'display_name'), ''), split_part(new.email, '@', 1), 'Spieler'), 30))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Tipp prüfen und normalisieren.
create or replace function public.tips_validate() returns trigger
language plpgsql set search_path = '' as $$
declare
  ev public.events;
  arr jsonb;
  n int;
  min_n int;
  max_n int;
  bad text;
  p jsonb := new.picks;
begin
  select * into ev from public.events where id = new.event_id;
  if ev.id is null then raise exception 'Unbekanntes Rennwochenende.'; end if;
  if new.kind = 'sprint' and ev.sprint_start is null then raise exception 'Dieses Wochenende hat keinen Sprint.'; end if;
  if jsonb_typeof(p) <> 'object' then raise exception 'Ungültiger Tipp.'; end if;

  if new.kind in ('quali', 'sprint', 'race') then
    arr := p->'order';
    if arr is null or jsonb_typeof(arr) <> 'array' then raise exception 'Ungültiger Tipp.'; end if;
    n := jsonb_array_length(arr);
    min_n := case new.kind when 'quali' then 1 else 3 end;
    max_n := case new.kind when 'race' then 10 else 3 end;
    if n < min_n or n > max_n then
      raise exception 'Bitte % bis % Fahrer wählen.', min_n, max_n;
    end if;
    if exists (select 1 from jsonb_array_elements(arr) v where jsonb_typeof(v) <> 'string') then
      raise exception 'Bitte jeden Platz mit einem Fahrer besetzen.';
    end if;
    if (select count(distinct v) from jsonb_array_elements_text(arr) v) <> n then
      raise exception 'Jeder Fahrer darf nur einmal vorkommen.';
    end if;
    select v into bad from jsonb_array_elements_text(arr) v
      where not exists (select 1 from public.season_drivers d where d.season = ev.season and d.driver_id = v and d.active) limit 1;
    if bad is not null then raise exception 'Fahrer «%» ist an diesem Wochenende nicht wählbar.', bad; end if;
    new.picks := jsonb_build_object('order', arr);
  else
    -- Zusatztipps
    if exists (select 1 from jsonb_object_keys(p) k where k not in ('fastest', 'dotd', 'sc', 'dnf', 'firstDnf')) then
      raise exception 'Unbekannter Zusatztipp.';
    end if;
    select v into bad from (values (p->'fastest'), (p->'dotd'), (p->'firstDnf')) x(v)
      where v is not null and jsonb_typeof(v) <> 'null'
        and (jsonb_typeof(v) <> 'string' or not exists (select 1 from public.season_drivers d where d.season = ev.season and d.driver_id = v #>> '{}' and d.active))
      limit 1;
    if bad is not null then raise exception 'Ungültiger Fahrer im Zusatztipp.'; end if;
    if p ? 'sc' and jsonb_typeof(p->'sc') <> 'null' and not (jsonb_typeof(p->'sc') = 'number' and (p->>'sc')::numeric in (0, 1, 2, 3, 4)) then
      raise exception 'Safety Car: 0 bis 4 (4 = vier oder mehr).';
    end if;
    if p ? 'dnf' and jsonb_typeof(p->'dnf') <> 'null' and not (jsonb_typeof(p->'dnf') = 'number' and (p->>'dnf')::numeric in (0, 1, 2, 3, 4, 5, 6)) then
      raise exception 'Ausfälle: 0 bis 6 (6 = sechs oder mehr).';
    end if;
    new.picks := jsonb_strip_nulls(jsonb_build_object(
      'fastest', p->'fastest', 'dotd', p->'dotd', 'sc', p->'sc', 'dnf', p->'dnf', 'firstDnf', p->'firstDnf'));
    if new.picks = '{}'::jsonb then raise exception 'Leerer Zusatztipp.'; end if;
    if (new.picks->>'dnf') = '0' and new.picks ? 'firstDnf' then
      raise exception 'Ohne Ausfall gibt es keinen ersten Ausfall.';
    end if;
  end if;

  if tg_op = 'UPDATE' then new.created_at := old.created_at; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists tips_validate on public.tips;
create trigger tips_validate before insert or update on public.tips
  for each row execute function public.tips_validate();

-- Resultate: Prüfsumme und Zeitpunkt nachführen, wenn sich etwas ändert.
create or replace function public.events_results_stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.results is distinct from old.results then
    new.results_hash := case when new.results is null then null else md5(new.results::text) end;
    new.results_at := case when new.results is null then null else now() end;
  end if;
  return new;
end $$;
drop trigger if exists events_results_stamp on public.events;
create trigger events_results_stamp before insert or update on public.events
  for each row execute function public.events_results_stamp();

-- -----------------------------------------------------------------------------
-- Zugriffsregeln (Row Level Security)
-- -----------------------------------------------------------------------------
alter table public.profiles       enable row level security;
alter table public.groups         enable row level security;
alter table public.memberships    enable row level security;
alter table public.group_seasons  enable row level security;
alter table public.events         enable row level security;
alter table public.season_drivers enable row level security;
alter table public.tips           enable row level security;
alter table public.scores         enable row level security;
alter table public.group_events   enable row level security;
alter table public.adjustments    enable row level security;

-- Tabellenrechte: so knapp wie möglich. Nicht angemeldete Besucher sehen nur
-- Kalender und Fahrer. Gruppen, Mitgliedschaften und Einstellungen ändern
-- sich nur über die Funktionen unten (sie prüfen Admin-Rechte).
revoke all on public.profiles, public.groups, public.memberships, public.group_seasons,
  public.tips, public.events, public.season_drivers from anon, authenticated;
grant select on public.events, public.season_drivers to anon, authenticated;
grant select on public.groups, public.memberships, public.group_seasons to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.tips to authenticated;
-- Punkte, Fahrer des Tages und Korrekturen: nur lesen. Geschrieben wird
-- ausschliesslich über die Funktionen unten.
revoke all on public.scores, public.group_events, public.adjustments from anon, authenticated;
grant select on public.scores, public.group_events, public.adjustments to authenticated;
-- Sync-Job (Service-Key) schreibt Kalender, Fahrer und Resultate. Explizit, damit
-- es auch ohne «Automatically expose new tables» funktioniert.
grant all on public.profiles, public.groups, public.memberships, public.group_seasons,
  public.tips, public.events, public.season_drivers, public.scores, public.group_events,
  public.adjustments to service_role;

drop policy if exists events_read on public.events;
create policy events_read on public.events for select using (true);
drop policy if exists drivers_read on public.season_drivers;
create policy drivers_read on public.season_drivers for select using (true);

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_group(id));
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert to authenticated with check (id = auth.uid());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists groups_read on public.groups;
create policy groups_read on public.groups for select to authenticated using (public.is_member(id));

drop policy if exists memberships_read on public.memberships;
create policy memberships_read on public.memberships for select to authenticated using (public.is_member(group_id));

drop policy if exists group_seasons_read on public.group_seasons;
create policy group_seasons_read on public.group_seasons for select to authenticated using (public.is_member(group_id));

-- Eigene Tipps: immer sichtbar. Fremde Tipps: erst nach dem Tippschluss.
-- Schreiben, ändern, löschen: nur eigene, nur als Mitglied, nur vor dem Tippschluss.
drop policy if exists tips_read on public.tips;
create policy tips_read on public.tips for select to authenticated
  using (user_id = auth.uid() or (public.is_member(group_id) and not public.tip_open(group_id, event_id, kind)));
drop policy if exists tips_insert on public.tips;
create policy tips_insert on public.tips for insert to authenticated
  with check (user_id = auth.uid() and source = 'user' and public.is_member(group_id) and public.tip_open(group_id, event_id, kind));
drop policy if exists tips_update on public.tips;
create policy tips_update on public.tips for update to authenticated
  using (user_id = auth.uid() and public.tip_open(group_id, event_id, kind))
  with check (user_id = auth.uid() and source = 'user' and public.is_member(group_id) and public.tip_open(group_id, event_id, kind));
drop policy if exists tips_delete on public.tips;
create policy tips_delete on public.tips for delete to authenticated
  using (user_id = auth.uid() and public.tip_open(group_id, event_id, kind));

drop policy if exists scores_read on public.scores;
create policy scores_read on public.scores for select to authenticated using (public.is_member(group_id));
drop policy if exists group_events_read on public.group_events;
create policy group_events_read on public.group_events for select to authenticated using (public.is_member(group_id));
drop policy if exists adjustments_read on public.adjustments;
create policy adjustments_read on public.adjustments for select to authenticated using (public.is_member(group_id));

-- -----------------------------------------------------------------------------
-- Funktionen für die Seite (RPC). Alle geben JSON zurück.
-- -----------------------------------------------------------------------------

-- Kalender und Fahrerfeld einer Saison (auch ohne Anmeldung).
create or replace function public.season_data(p_season int default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  with s as (select coalesce(p_season, public.current_season()) as season)
  select jsonb_build_object(
    'season', (select season from s),
    'now', now(),
    'events', coalesce((select jsonb_agg(jsonb_build_object(
        'id', e.id, 'season', e.season, 'round', e.round, 'name', e.name, 'circuit_id', e.circuit_id, 'country', e.country,
        'quali_start', e.quali_start, 'sprint_quali_start', e.sprint_quali_start, 'sprint_start', e.sprint_start,
        'race_start', e.race_start, 'status', e.status, 'has_results', e.results is not null) order by e.round)
      from public.events e where e.season = (select season from s)), '[]'::jsonb),
    'drivers', coalesce((select jsonb_agg(to_jsonb(d) order by d.family_name)
      from public.season_drivers d where d.season = (select season from s)), '[]'::jsonb))
$$;

create or replace function public.my_profile() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r jsonb;
begin
  select jsonb_build_object('id', p.id, 'display_name', p.display_name, 'avatar', p.avatar, 'created_at', p.created_at)
    into r from public.profiles p where p.id = v_uid;
  if r is null then
    insert into public.profiles (id, display_name) values (v_uid, 'Spieler') on conflict do nothing;
    return public.my_profile();
  end if;
  return r;
end $$;

create or replace function public.update_profile(p_name text, p_avatar jsonb default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user();
begin
  if p_name is null or char_length(btrim(p_name)) not between 1 and 30 then raise exception 'Der Name muss 1 bis 30 Zeichen haben.'; end if;
  if p_avatar is not null and (jsonb_typeof(p_avatar) <> 'object'
      or exists (select 1 from jsonb_object_keys(p_avatar) k where k not in ('color', 'driver'))
      or coalesce(p_avatar->>'color', '#000000') !~ '^#[0-9a-fA-F]{6}$'
      or coalesce(p_avatar->>'driver', 'x') !~ '^[a-z_]{1,40}$') then
    raise exception 'Ungültiger Avatar.';
  end if;
  update public.profiles set display_name = btrim(p_name), avatar = coalesce(p_avatar, avatar) where id = v_uid;
  return public.my_profile();
end $$;

create or replace function public.my_groups() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := public.require_user();
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', g.id, 'name', g.name, 'role', m.role, 'invite_code', g.invite_code, 'created_at', g.created_at,
      'members', (select count(*) from public.memberships x where x.group_id = g.id),
      'settings', public.group_settings(g.id, public.current_season())) order by m.joined_at)
    from public.memberships m join public.groups g on g.id = m.group_id where m.user_id = v_uid), '[]'::jsonb);
end $$;

create or replace function public.create_group(p_name text, p_settings jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); v_id uuid; v_code text;
begin
  if p_name is null or char_length(btrim(p_name)) not between 2 and 40 then raise exception 'Der Gruppenname muss 2 bis 40 Zeichen haben.'; end if;
  if not public.valid_settings(coalesce(p_settings, '{}'::jsonb)) then raise exception 'Ungültige Einstellungen.'; end if;
  if (select count(*) from public.groups where created_by = v_uid) >= 10 then raise exception 'Du kannst höchstens 10 Gruppen erstellen.'; end if;
  loop
    v_code := public.new_invite_code();
    exit when not exists (select 1 from public.groups where invite_code = v_code);
  end loop;
  insert into public.groups (name, invite_code, created_by) values (btrim(p_name), v_code, v_uid) returning id into v_id;
  insert into public.memberships (group_id, user_id, role) values (v_id, v_uid, 'admin');
  insert into public.group_seasons (group_id, season, settings) values (v_id, public.current_season(), public.default_settings() || coalesce(p_settings, '{}'::jsonb));
  return jsonb_build_object('id', v_id, 'invite_code', v_code);
end $$;

-- Vorschau für den Einladungslink (Name und Grösse der Gruppe).
create or replace function public.group_preview(p_code text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', g.id, 'name', g.name,
    'members', (select count(*) from public.memberships m where m.group_id = g.id),
    'is_member', public.is_member(g.id))
  from public.groups g where g.invite_code = upper(btrim(p_code))
$$;

create or replace function public.join_group(p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); v_id uuid;
begin
  select id into v_id from public.groups where invite_code = upper(btrim(p_code));
  if v_id is null then raise exception 'Dieser Einladungscode ist ungültig oder abgelaufen.'; end if;
  if (select count(*) from public.memberships where group_id = v_id) >= 50 then raise exception 'Diese Gruppe ist voll (50 Mitglieder).'; end if;
  insert into public.memberships (group_id, user_id) values (v_id, v_uid) on conflict do nothing;
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.group_detail(p_group uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := public.require_user();
begin
  if not public.is_member(p_group) then raise exception 'Du bist nicht Mitglied dieser Gruppe.'; end if;
  return (select jsonb_build_object(
    'id', g.id, 'name', g.name, 'invite_code', g.invite_code, 'created_at', g.created_at,
    'role', (select role from public.memberships where group_id = g.id and user_id = v_uid),
    'season', public.current_season(),
    'settings', public.group_settings(g.id, public.current_season()),
    'points', public.points_preset(public.group_settings(g.id, public.current_season())->>'preset'),
    'members', (select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'name', p.display_name, 'avatar', p.avatar,
        'role', m.role, 'joined_at', m.joined_at) order by m.joined_at)
      from public.memberships m join public.profiles p on p.id = m.user_id where m.group_id = g.id))
    from public.groups g where g.id = p_group);
end $$;

create or replace function public.update_group(p_group uuid, p_name text default null, p_settings jsonb default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); v_season int := public.current_season(); v_new jsonb;
begin
  if not public.is_admin(p_group) then raise exception 'Nur Admins können die Gruppe ändern.'; end if;
  if p_name is not null then
    if char_length(btrim(p_name)) not between 2 and 40 then raise exception 'Der Gruppenname muss 2 bis 40 Zeichen haben.'; end if;
    update public.groups set name = btrim(p_name) where id = p_group;
  end if;
  if p_settings is not null then
    v_new := public.group_settings(p_group, v_season) || p_settings;
    if not public.valid_settings(v_new) then raise exception 'Ungültige Einstellungen.'; end if;
    insert into public.group_seasons (group_id, season, settings) values (p_group, v_season, v_new)
      on conflict (group_id, season) do update set settings = excluded.settings;
    perform public.score_group_season(p_group, v_season);
  end if;
  return public.group_detail(p_group);
end $$;

create or replace function public.regenerate_invite(p_group uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); v_code text;
begin
  if not public.is_admin(p_group) then raise exception 'Nur Admins können den Code erneuern.'; end if;
  loop
    v_code := public.new_invite_code();
    exit when not exists (select 1 from public.groups where invite_code = v_code);
  end loop;
  update public.groups set invite_code = v_code where id = p_group;
  return jsonb_build_object('invite_code', v_code);
end $$;

create or replace function public.set_member_role(p_group uuid, p_user uuid, p_role text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user();
begin
  if not public.is_admin(p_group) then raise exception 'Nur Admins können Rollen ändern.'; end if;
  if p_role not in ('admin', 'member') then raise exception 'Unbekannte Rolle.'; end if;
  if p_role = 'member' and (select count(*) from public.memberships where group_id = p_group and role = 'admin' and user_id <> p_user) = 0 then
    raise exception 'Eine Gruppe braucht mindestens einen Admin.';
  end if;
  update public.memberships set role = p_role where group_id = p_group and user_id = p_user;
  return public.group_detail(p_group);
end $$;

create or replace function public.remove_member(p_group uuid, p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user();
begin
  if not public.is_admin(p_group) then raise exception 'Nur Admins können Mitglieder entfernen.'; end if;
  if p_user = v_uid then raise exception 'Um selbst auszutreten, nutze «Gruppe verlassen».'; end if;
  delete from public.memberships where group_id = p_group and user_id = p_user;
  return public.group_detail(p_group);
end $$;

-- Austreten. Der letzte Admin übergibt automatisch an das älteste Mitglied;
-- ist niemand mehr da, wird die Gruppe gelöscht.
create or replace function public.leave_group(p_group uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); v_next uuid;
begin
  if not public.is_member(p_group) then return jsonb_build_object('ok', true); end if;
  if public.is_admin(p_group) and (select count(*) from public.memberships where group_id = p_group and role = 'admin') = 1 then
    select user_id into v_next from public.memberships where group_id = p_group and user_id <> v_uid order by joined_at limit 1;
    if v_next is not null then update public.memberships set role = 'admin' where group_id = p_group and user_id = v_next; end if;
  end if;
  delete from public.memberships where group_id = p_group and user_id = v_uid;
  if not exists (select 1 from public.memberships where group_id = p_group) then delete from public.groups where id = p_group; end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.delete_group(p_group uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user();
begin
  if not public.is_admin(p_group) then raise exception 'Nur Admins können die Gruppe löschen.'; end if;
  delete from public.groups where id = p_group;
  return jsonb_build_object('ok', true);
end $$;

-- Alles, was das Tipp-Formular braucht: Wochenende, meine Gruppen mit
-- Tippschluss je Art und meine bisherigen Tipps. "now" = Serverzeit.
create or replace function public.event_state(p_event text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); ev public.events;
begin
  select * into ev from public.events where id = p_event;
  if ev.id is null then raise exception 'Unbekanntes Rennwochenende.'; end if;
  return jsonb_build_object(
    'now', now(),
    'event', jsonb_build_object('id', ev.id, 'season', ev.season, 'round', ev.round, 'name', ev.name, 'status', ev.status,
      'quali_start', ev.quali_start, 'sprint_quali_start', ev.sprint_quali_start, 'sprint_start', ev.sprint_start, 'race_start', ev.race_start),
    'groups', coalesce((select jsonb_agg(jsonb_build_object(
        'id', g.id, 'name', g.name,
        'settings', public.group_settings(g.id, ev.season),
        'locks', (select jsonb_object_agg(k, public.lock_time(g.id, ev.id, k)) from unnest(array['quali', 'sprint', 'race', 'extras']) k),
        'open', (select jsonb_object_agg(k, public.tip_open(g.id, ev.id, k)) from unnest(array['quali', 'sprint', 'race', 'extras']) k),
        'tips', coalesce((select jsonb_object_agg(t.kind, jsonb_build_object('picks', t.picks, 'updated_at', t.updated_at))
          from public.tips t where t.group_id = g.id and t.user_id = v_uid and t.event_id = ev.id), '{}'::jsonb)
      ) order by m.joined_at)
      from public.memberships m join public.groups g on g.id = m.group_id where m.user_id = v_uid), '[]'::jsonb),
    -- Mein letzter Tipp vor diesem Wochenende (für «letzten Tipp übernehmen»)
    'previous', coalesce((select jsonb_object_agg(kind, picks) from (
        select distinct on (t.kind) t.kind, t.picks from public.tips t join public.events e on e.id = t.event_id
        where t.user_id = v_uid and t.source = 'user' and e.race_start < ev.race_start
        order by t.kind, e.race_start desc, t.updated_at desc) x), '{}'::jsonb));
end $$;

-- Tipp für mehrere Gruppen auf einmal speichern (oder mit p_picks = null löschen).
-- Läuft mit den Rechten des Spielers: die Zugriffsregeln oben gelten voll.
-- Gibt pro Gruppe zurück, ob es geklappt hat.
create or replace function public.save_tips(p_event text, p_kind text, p_picks jsonb, p_groups uuid[]) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare v_uid uuid := public.require_user(); g uuid; res jsonb := '[]'::jsonb;
begin
  if p_kind not in ('quali', 'sprint', 'race', 'extras') then raise exception 'Unbekannte Tipp-Art.'; end if;
  if not exists (select 1 from public.events where id = p_event) then raise exception 'Unbekanntes Rennwochenende.'; end if;
  if p_kind = 'sprint' and not exists (select 1 from public.events where id = p_event and sprint_start is not null) then
    raise exception 'Dieses Wochenende hat keinen Sprint.';
  end if;
  foreach g in array coalesce(p_groups, '{}') loop
    begin
      if not public.is_member(g) then raise exception 'Du bist nicht Mitglied dieser Gruppe.'; end if;
      if not public.tip_open(g, p_event, p_kind) then raise exception 'Tippschluss vorbei.'; end if;
      if p_picks is null then
        delete from public.tips where group_id = g and user_id = v_uid and event_id = p_event and kind = p_kind;
      else
        insert into public.tips (group_id, user_id, event_id, kind, picks) values (g, v_uid, p_event, p_kind, p_picks)
          on conflict (group_id, user_id, event_id, kind) do update set picks = excluded.picks, source = 'user';
      end if;
      res := res || jsonb_build_object('group_id', g, 'ok', true);
    exception when others then
      res := res || jsonb_build_object('group_id', g, 'ok', false, 'error', sqlerrm);
    end;
  end loop;
  return res;
end $$;

-- Gültige Tipps einer Gruppe für ein Wochenende (intern, ohne Sichtbarkeitsregel):
-- alle gespeicherten Tipps plus, bei «letzten Tipp übernehmen», für jede bereits
-- geschlossene Art der letzte eigene Tipp derselben Art aus dieser Saison (source = auto).
create or replace function public.effective_tips(p_group uuid, p_event text)
returns table (user_id uuid, kind text, picks jsonb, source text, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  with ev as (select * from public.events where id = p_event),
  st as (select public.group_settings(p_group, ev.season) as s from ev),
  locked as (
    select k from ev, unnest(array['quali', 'sprint', 'race', 'extras']) k
    where now() >= public.lock_time(p_group, ev.id, k) and (k <> 'sprint' or ev.sprint_start is not null))
  select t.user_id, t.kind, t.picks, t.source, t.updated_at from public.tips t
  where t.group_id = p_group and t.event_id = p_event
  union all
  (select distinct on (m.user_id, l.k) m.user_id, l.k, t.picks, 'auto'::text, t.updated_at
   from ev, st, public.memberships m
   cross join locked l
   join public.tips t on t.group_id = p_group and t.user_id = m.user_id and t.kind = l.k and t.source = 'user'
   join public.events e2 on e2.id = t.event_id
   where m.group_id = p_group and st.s->>'missing' = 'carry' and ev.status = 'scheduled'
     and e2.season = ev.season and e2.race_start < ev.race_start
     and not exists (select 1 from public.tips x where x.group_id = p_group and x.user_id = m.user_id and x.event_id = p_event and x.kind = l.k)
   order by m.user_id, l.k, e2.race_start desc)
$$;

-- Tippübersicht einer Gruppe für ein Wochenende.
--   * Wer schon getippt hat, ist immer sichtbar (ohne Inhalt).
--   * Inhalte fremder Tipps erst nach dem Tippschluss der jeweiligen Art.
--   * Fehlende Tipps: siehe effective_tips.
--   * Dazu Resultat, Fahrer des Tages und Punkte (sobald ausgewertet).
create or replace function public.group_event(p_group uuid, p_event text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); ev public.events; s jsonb;
begin
  if not public.is_member(p_group) then raise exception 'Du bist nicht Mitglied dieser Gruppe.'; end if;
  select * into ev from public.events where id = p_event;
  if ev.id is null then raise exception 'Unbekanntes Rennwochenende.'; end if;
  s := public.group_settings(p_group, ev.season);
  return (
    with kinds as (
      select k, public.lock_time(p_group, ev.id, k) as lt from unnest(array['quali', 'sprint', 'race', 'extras']) k
    ), locked as (
      select k from kinds where lt is not null and now() >= lt and (k <> 'sprint' or ev.sprint_start is not null)
    )
    select jsonb_build_object(
      'now', now(),
      'settings', s,
      'points', public.points_preset(s->>'preset'),
      'locks', (select jsonb_object_agg(k, lt) from kinds),
      'members', (select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'name', p.display_name, 'avatar', p.avatar, 'role', m.role) order by p.display_name)
        from public.memberships m join public.profiles p on p.id = m.user_id where m.group_id = p_group),
      'status', coalesce((select jsonb_agg(jsonb_build_object('user_id', t.user_id, 'kind', t.kind, 'updated_at', t.updated_at))
        from public.tips t where t.group_id = p_group and t.event_id = ev.id), '[]'::jsonb),
      'tips', coalesce((select jsonb_agg(to_jsonb(z)) from public.effective_tips(p_group, ev.id) z
        where z.user_id = v_uid or z.kind in (select k from locked)), '[]'::jsonb),
      'results', ev.results,
      'results_at', ev.results_at,
      'dotd', (select dotd from public.group_events where group_id = p_group and event_id = ev.id),
      'scores', coalesce((select jsonb_agg(jsonb_build_object('user_id', sc.user_id, 'points', sc.points, 'exact', sc.exact, 'detail', sc.detail))
        from public.scores sc where sc.group_id = p_group and sc.event_id = ev.id), '[]'::jsonb),
      'adjustments', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'user_id', a.user_id, 'points', a.points, 'reason', a.reason, 'created_at', a.created_at))
        from public.adjustments a where a.group_id = p_group and a.event_id = ev.id), '[]'::jsonb))
  );
end $$;

-- -----------------------------------------------------------------------------
-- Auswertung
-- -----------------------------------------------------------------------------
-- Resultat (events.results, geschrieben vom Sync-Job):
--   {"quali": [Fahrer in Reihenfolge], "sprint": [...], "race": [...],
--    "fastest": "id", "dnf": ["id", …], "firstDnf": ["id", …], "sc": 2}
-- Fehlt ein Teil, bleibt der zugehörige Tipp «offen» (noch keine Punkte).
--
-- Punkte für einen einzelnen Tipp (reine Funktion, siehe tests/db.test.js).
-- Ergebnis: {"points", "exact", "items": [{k, d, s, a, p, x}], "open": [...]}
--   k = Art des Treffers (Schlüssel aus points_preset), d = Fahrer, s = getippter
--   Platz, a = tatsächlicher Platz, p = Punkte, x = exakter Treffer.
-- null = für diese Art gibt es noch kein Resultat.
create or replace function public.score_kind(p_kind text, p_picks jsonb, p_res jsonb, p_pts jsonb, p_dotd text default null)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  pts jsonb := coalesce(p_pts->p_kind, '{}'::jsonb);
  items jsonb := '[]'::jsonb;
  open_ text[] := '{}';
  total int := 0; n_exact int := 0;
  res jsonb; slots int; cnt int; i int; d text; pos int; k text; v int; hit boolean;
  all_exact boolean := true; podium_exact boolean := true;
  t int; a int;
begin
  if p_res is null or jsonb_typeof(p_res) <> 'object' then return null; end if;

  if p_kind in ('quali', 'sprint', 'race') then
    res := p_res->p_kind;
    if res is null or jsonb_typeof(res) <> 'array' or jsonb_array_length(res) = 0 then return null; end if;
    slots := case p_kind when 'race' then 10 else 3 end;
    cnt := coalesce(jsonb_array_length(p_picks->'order'), 0);
    for i in 0 .. cnt - 1 loop
      d := p_picks->'order'->>i;
      select x.o into pos from jsonb_array_elements_text(res) with ordinality x(drv, o) where x.drv = d;
      hit := pos = i + 1;
      k := null;
      if hit then
        k := case when p_kind = 'quali' and i = 0 then 'pole' when p_kind = 'race' and i < 3 then 'podium' else 'exact' end;
      else
        all_exact := false;
        if i < 3 then podium_exact := false; end if;
        if pos is not null and pos <= slots then
          k := case
            when p_kind = 'race' and i < 3 and pos <= 3 then 'podiumIn'
            when p_kind = 'race' and i >= 3 and abs(pos - (i + 1)) = 1 and coalesce((pts->>'near')::int, 0) > 0 then 'near'
            else 'inTop' end;
        end if;
      end if;
      v := coalesce((pts->>k)::int, 0);
      if k is not null and v <> 0 then
        items := items || jsonb_build_object('k', k, 'd', d, 's', i + 1, 'a', pos, 'p', v, 'x', hit);
        total := total + v;
        if hit then n_exact := n_exact + 1; end if;
      end if;
      pos := null;
    end loop;
    -- Boni für komplett richtige Tipps
    if p_kind in ('quali', 'sprint') and cnt = 3 and all_exact and coalesce((pts->>'bonus')::int, 0) <> 0 then
      items := items || jsonb_build_object('k', 'bonus', 'p', (pts->>'bonus')::int);
      total := total + (pts->>'bonus')::int;
    end if;
    if p_kind = 'race' and cnt >= 3 and podium_exact and coalesce((pts->>'bonusPodium')::int, 0) <> 0 then
      items := items || jsonb_build_object('k', 'bonusPodium', 'p', (pts->>'bonusPodium')::int);
      total := total + (pts->>'bonusPodium')::int;
    end if;
    if p_kind = 'race' and cnt = 10 and all_exact and coalesce((pts->>'bonusTop10')::int, 0) <> 0 then
      items := items || jsonb_build_object('k', 'bonusTop10', 'p', (pts->>'bonusTop10')::int);
      total := total + (pts->>'bonusTop10')::int;
    end if;

  elsif p_kind = 'extras' then
    -- Zusatztipps hängen am Rennen: ohne Rennresultat noch offen.
    if p_res->'race' is null or jsonb_typeof(p_res->'race') <> 'array' or jsonb_array_length(p_res->'race') = 0 then return null; end if;
    if p_picks ? 'fastest' then
      if p_res->>'fastest' is null then open_ := open_ || 'fastest'::text;
      elsif p_picks->>'fastest' = p_res->>'fastest' and coalesce((pts->>'fastest')::int, 0) <> 0 then
        items := items || jsonb_build_object('k', 'fastest', 'd', p_picks->>'fastest', 'p', (pts->>'fastest')::int, 'x', true);
        total := total + (pts->>'fastest')::int; n_exact := n_exact + 1;
      end if;
    end if;
    if p_picks ? 'dotd' then
      if p_dotd is null then open_ := open_ || 'dotd'::text;
      elsif p_picks->>'dotd' = p_dotd and coalesce((pts->>'dotd')::int, 0) <> 0 then
        items := items || jsonb_build_object('k', 'dotd', 'd', p_dotd, 'p', (pts->>'dotd')::int, 'x', true);
        total := total + (pts->>'dotd')::int; n_exact := n_exact + 1;
      end if;
    end if;
    if p_picks ? 'sc' then
      if p_res->'sc' is null or jsonb_typeof(p_res->'sc') <> 'number' then open_ := open_ || 'sc'::text;
      else
        t := (p_picks->>'sc')::int; a := least((p_res->>'sc')::int, 4);
        if (t > 0) = (a > 0) and coalesce((pts->>'scYes')::int, 0) <> 0 then
          items := items || jsonb_build_object('k', 'scYes', 'p', (pts->>'scYes')::int, 'a', a);
          total := total + (pts->>'scYes')::int;
        end if;
        if t = a and coalesce((pts->>'sc')::int, 0) <> 0 then
          items := items || jsonb_build_object('k', 'sc', 'p', (pts->>'sc')::int, 'a', a, 'x', true);
          total := total + (pts->>'sc')::int; n_exact := n_exact + 1;
        end if;
      end if;
    end if;
    if p_picks ? 'dnf' then
      t := (p_picks->>'dnf')::int; a := least(coalesce(jsonb_array_length(p_res->'dnf'), 0), 6);
      if t = a and coalesce((pts->>'dnf')::int, 0) <> 0 then
        items := items || jsonb_build_object('k', 'dnf', 'p', (pts->>'dnf')::int, 'a', a, 'x', true);
        total := total + (pts->>'dnf')::int; n_exact := n_exact + 1;
      elsif abs(t - a) = 1 and coalesce((pts->>'dnfNear')::int, 0) <> 0 then
        items := items || jsonb_build_object('k', 'dnfNear', 'p', (pts->>'dnfNear')::int, 'a', a);
        total := total + (pts->>'dnfNear')::int;
      end if;
    end if;
    if p_picks ? 'firstDnf' and coalesce(p_res->'firstDnf', '[]'::jsonb) ? (p_picks->>'firstDnf')
       and coalesce((pts->>'firstDnf')::int, 0) <> 0 then
      items := items || jsonb_build_object('k', 'firstDnf', 'd', p_picks->>'firstDnf', 'p', (pts->>'firstDnf')::int, 'x', true);
      total := total + (pts->>'firstDnf')::int; n_exact := n_exact + 1;
    end if;
  else
    return null;
  end if;

  return jsonb_build_object('points', total, 'exact', n_exact, 'items', items, 'open', to_jsonb(open_));
end $$;

-- Punkte einer Gruppe für ein Wochenende neu berechnen (alles oder nichts).
-- Aussenseiter-Bonus: exakter Treffer, den bei mindestens 3 Tippern dieser Art
-- nur einer (alone) bzw. höchstens 25 % (few) haben.
create or replace function public.score_group_event(p_group uuid, p_event text) returns void
language plpgsql security definer set search_path = '' as $$
declare ev public.events; s jsonb; pts jsonb; v_dotd text; v_rows jsonb;
begin
  delete from public.scores where group_id = p_group and event_id = p_event;
  select * into ev from public.events where id = p_event;
  if ev.id is null or ev.results is null or ev.status <> 'scheduled' then return; end if;
  s := public.group_settings(p_group, ev.season);
  pts := public.points_preset(s->>'preset');
  select dotd into v_dotd from public.group_events where group_id = p_group and event_id = p_event;

  select coalesce(jsonb_agg(jsonb_build_object('u', t.user_id, 'kind', t.kind, 'r', r.r)), '[]'::jsonb) into v_rows
  from public.effective_tips(p_group, p_event) t
  cross join lateral (select public.score_kind(t.kind, t.picks, ev.results, pts, v_dotd) as r) r
  where r.r is not null and now() >= public.lock_time(p_group, p_event, t.kind);

  insert into public.scores (group_id, user_id, event_id, points, exact, detail)
  with sr as (
    select (e->>'u')::uuid as u, e->>'kind' as kind, e->'r' as r from jsonb_array_elements(v_rows) e
  ), tippers as (
    select kind, count(*) as n from sr group by kind
  ), hits as (
    select sr.u, sr.kind, it, sr.kind || ':' || (it->>'k') || ':' || coalesce(it->>'s', '') || ':' || coalesce(it->>'d', '') as key
    from sr, jsonb_array_elements(sr.r->'items') it where (it->>'x')::boolean
  ), cnt as (
    select key, count(*) as c from hits group by key
  ), bonus as (
    select h.u, h.kind, jsonb_build_object('k', 'outsider', 'ref', h.it->>'k', 'd', h.it->'d', 's', h.it->'s',
      'p', case when c.c = 1 then (pts->'outsider'->>'alone')::int else (pts->'outsider'->>'few')::int end, 'alone', c.c = 1) as b
    from hits h join cnt c on c.key = h.key join tippers tp on tp.kind = h.kind
    where tp.n >= 3 and (c.c = 1 or c.c::numeric / tp.n <= 0.25)
  ), merged as (
    select r.u, r.kind,
      r.r || jsonb_build_object(
        'items', (r.r->'items') || coalesce((select jsonb_agg(b.b) from bonus b where b.u = r.u and b.kind = r.kind and (b.b->>'p')::int <> 0), '[]'::jsonb),
        'points', (r.r->>'points')::int + coalesce((select sum((b.b->>'p')::int) from bonus b where b.u = r.u and b.kind = r.kind), 0)) as r
    from sr r
  )
  select p_group, u, p_event, sum((r->>'points')::int), sum((r->>'exact')::int), jsonb_object_agg(kind, r)
  from merged group by u;
end $$;

create or replace function public.score_event(p_event text) returns void
language plpgsql security definer set search_path = '' as $$
declare g uuid;
begin
  for g in select id from public.groups loop
    perform public.score_group_event(g, p_event);
  end loop;
end $$;

-- Alle ausgewerteten Wochenenden einer Gruppe in einer Saison neu berechnen
-- (z. B. nach dem Wechsel des Punktesystems).
create or replace function public.score_group_season(p_group uuid, p_season int) returns void
language plpgsql security definer set search_path = '' as $$
declare e text;
begin
  for e in select id from public.events where season = p_season and results is not null loop
    perform public.score_group_event(p_group, e);
  end loop;
end $$;

-- Neues oder geändertes Resultat (auch nach Strafen) bzw. Absage → neu auswerten.
create or replace function public.events_rescore() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.results_hash is distinct from old.results_hash or new.status is distinct from old.status then
    perform public.score_event(new.id);
  end if;
  return null;
end $$;
drop trigger if exists events_rescore on public.events;
create trigger events_rescore after update on public.events
  for each row execute function public.events_rescore();

-- Fahrer des Tages eintragen (Admin). p_driver = null löscht den Eintrag.
create or replace function public.set_dotd(p_group uuid, p_event text, p_driver text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); ev public.events;
begin
  if not public.is_admin(p_group) then raise exception 'Nur Admins können den Fahrer des Tages eintragen.'; end if;
  select * into ev from public.events where id = p_event;
  if ev.id is null then raise exception 'Unbekanntes Rennwochenende.'; end if;
  if now() < ev.race_start then raise exception 'Der Fahrer des Tages steht erst nach dem Rennen fest.'; end if;
  if p_driver is not null and not exists (select 1 from public.season_drivers where season = ev.season and driver_id = p_driver) then
    raise exception 'Unbekannter Fahrer.';
  end if;
  insert into public.group_events (group_id, event_id, dotd, updated_by, updated_at) values (p_group, p_event, p_driver, v_uid, now())
    on conflict (group_id, event_id) do update set dotd = excluded.dotd, updated_by = excluded.updated_by, updated_at = now();
  perform public.score_group_event(p_group, p_event);
  return jsonb_build_object('ok', true);
end $$;

-- Punktekorrektur (Admin), immer mit Begründung; für alle Mitglieder sichtbar.
create or replace function public.add_adjustment(p_group uuid, p_user uuid, p_points int, p_reason text, p_event text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); v_season int; v_id bigint;
begin
  if not public.is_admin(p_group) then raise exception 'Nur Admins können Punkte korrigieren.'; end if;
  if not exists (select 1 from public.memberships where group_id = p_group and user_id = p_user) then raise exception 'Dieser Spieler ist nicht in der Gruppe.'; end if;
  if p_points is null or p_points = 0 or p_points not between -100 and 100 then raise exception 'Korrektur: -100 bis 100 Punkte, nicht 0.'; end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 2 and 120 then raise exception 'Bitte eine Begründung angeben (2 bis 120 Zeichen).'; end if;
  if p_event is not null then
    select season into v_season from public.events where id = p_event;
    if v_season is null then raise exception 'Unbekanntes Rennwochenende.'; end if;
  else
    v_season := public.current_season();
  end if;
  insert into public.adjustments (group_id, user_id, event_id, season, points, reason, created_by)
    values (p_group, p_user, p_event, v_season, p_points, btrim(p_reason), v_uid) returning id into v_id;
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.delete_adjustment(p_group uuid, p_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user();
begin
  if not public.is_admin(p_group) then raise exception 'Nur Admins können Korrekturen löschen.'; end if;
  delete from public.adjustments where id = p_id and group_id = p_group;
  return jsonb_build_object('ok', true);
end $$;

-- Rangliste einer Gruppe: alle Wochenenden der Saison, Punkte pro Spieler und
-- Wochenende, Korrekturen. Sortiert und gruppiert (Rennen/Monat/Saison) wird im
-- Browser (assets/js/tipp/ranking.js), damit alle Ansichten dieselben Regeln nutzen.
create or replace function public.group_standings(p_group uuid, p_season int default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); v_season int := coalesce(p_season, public.current_season());
begin
  if not public.is_member(p_group) then raise exception 'Du bist nicht Mitglied dieser Gruppe.'; end if;
  return jsonb_build_object(
    'season', v_season,
    'now', now(),
    'settings', public.group_settings(p_group, v_season),
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'round', e.round, 'name', e.name, 'country', e.country,
        'race_start', e.race_start, 'status', e.status, 'has_results', e.results is not null,
        'scored', exists (select 1 from public.scores sc where sc.group_id = p_group and sc.event_id = e.id)) order by e.round)
      from public.events e where e.season = v_season), '[]'::jsonb),
    'members', coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'name', p.display_name, 'avatar', p.avatar, 'role', m.role) order by p.display_name)
      from public.memberships m join public.profiles p on p.id = m.user_id where m.group_id = p_group), '[]'::jsonb),
    'scores', coalesce((select jsonb_agg(jsonb_build_object('user_id', sc.user_id, 'event_id', sc.event_id, 'points', sc.points, 'exact', sc.exact))
      from public.scores sc join public.events e on e.id = sc.event_id where sc.group_id = p_group and e.season = v_season), '[]'::jsonb),
    'adjustments', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'user_id', a.user_id, 'event_id', a.event_id, 'points', a.points,
        'reason', a.reason, 'created_at', a.created_at, 'by', (select display_name from public.profiles where id = a.created_by)) order by a.created_at)
      from public.adjustments a where a.group_id = p_group and a.season = v_season), '[]'::jsonb));
end $$;

-- Konto mit allen Daten löschen. Admin-Rollen werden vorher übergeben.
create or replace function public.delete_account() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); g uuid;
begin
  for g in select group_id from public.memberships where user_id = v_uid loop
    perform public.leave_group(g);
  end loop;
  delete from auth.users where id = v_uid;
  return jsonb_build_object('ok', true);
end $$;

-- Ausführungsrechte: Besucher ohne Konto dürfen nur Kalender und Einladungsvorschau.
revoke execute on all functions in schema public from public, anon;
grant execute on function public.season_data(int), public.group_preview(text), public.current_season(),
  public.default_settings(), public.valid_settings(jsonb) to anon;
grant execute on all functions in schema public to authenticated, service_role;
-- Interne Funktionen: nicht direkt aufrufbar (effective_tips würde verdeckte
-- Tipps zeigen, die score_*-Funktionen laufen nur über Trigger und RPCs oben).
revoke execute on function public.effective_tips(uuid, text), public.score_group_event(uuid, text),
  public.score_event(text), public.score_group_season(uuid, int), public.events_rescore(),
  public.events_results_stamp(), public.tips_validate(), public.handle_new_user() from authenticated;
