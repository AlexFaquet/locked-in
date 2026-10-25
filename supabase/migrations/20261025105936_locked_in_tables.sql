-- Locked In — a study tracker for a crew of friends.
--
-- Access model: you can see yourself and anyone who shares a crew with you,
-- and you can change only your own rows. Every table in public is behind
-- RLS. Joining a crew needs its invite code, so signing up shows you nothing
-- until someone lets you in.
--
-- Alfred (Alex's dashboard) connects with a link key that its owner creates
-- in the app. link_sync() acts for that one user and nobody else.

create extension if not exists btree_gist with schema extensions;

create schema if not exists private;
grant usage on schema private to authenticated;

/* ------------------------------------------------------------
   Tables
   ------------------------------------------------------------ */

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 24),
  emoji text not null default '📚' check (char_length(emoji) between 1 and 8),
  share_location boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.crews (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 40),
  code text not null unique,
  -- A crew outlives whoever started it.
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index crews_created_by_idx on public.crews (created_by);

create table public.crew_members (
  crew_id uuid not null references public.crews (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (crew_id, user_id)
);
create index crew_members_user_id_idx on public.crew_members (user_id);

-- Finished sessions. The id is chosen by whoever started the timer, so a
-- session keeps one identity across the app, Alfred and this table.
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  subject text not null check (char_length(btrim(subject)) between 1 and 40),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  location text check (char_length(location) <= 80),
  origin text not null default 'app' check (origin in ('app', 'alfred')),
  updated_at timestamptz not null default now(),
  constraint sessions_order check (ended_at > started_at),
  constraint sessions_length check (ended_at - started_at <= interval '16 hours'),
  -- One person can't be in two sessions at once; this holds under concurrency.
  constraint sessions_no_overlap exclude using gist (user_id with =, tstzrange(started_at, ended_at) with &&)
);
create index sessions_user_started_idx on public.sessions (user_id, started_at desc);

-- One row per person: who is studying right now. Stopping clears the row
-- rather than deleting it, because Realtime can't apply RLS to deletes.
create table public.live (
  user_id uuid primary key default auth.uid() references public.profiles (id) on delete cascade,
  session_id uuid,
  subject text check (char_length(btrim(subject)) between 1 and 40),
  started_at timestamptz,
  location text check (char_length(location) <= 80),
  origin text check (origin in ('app', 'alfred')),
  updated_at timestamptz not null default now(),
  constraint live_shape check ((started_at is null) = (subject is null) and (started_at is null) = (session_id is null))
);

-- "I'm coming" and cheers between crewmates.
create table public.pings (
  id bigint generated always as identity primary key,
  from_user uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  to_user uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('joining', 'cheer')),
  created_at timestamptz not null default now(),
  constraint pings_not_self check (from_user <> to_user)
);
create index pings_to_user_idx on public.pings (to_user, created_at desc);
create index pings_from_user_idx on public.pings (from_user);

-- Keys for Alfred. Only a SHA-256 of the key is stored; the key itself is
-- shown once, when it's made.
create table public.link_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  label text not null default 'Alfred' check (char_length(btrim(label)) between 1 and 30),
  key_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index link_keys_user_id_idx on public.link_keys (user_id);

-- Every table here is reachable over the Data API, so RLS goes on first.
alter table public.profiles enable row level security;
alter table public.crews enable row level security;
alter table public.crew_members enable row level security;
alter table public.sessions enable row level security;
alter table public.live enable row level security;
alter table public.pings enable row level security;
alter table public.link_keys enable row level security;
