-- The whole Locked In schema as it stands. Applied to the Supabase project
-- in parts; this file is the reference for what's there.
--
-- Locked In — a study tracker for a crew of friends.
--
-- Access model: you can see yourself and anyone who shares a crew with you,
-- and you can change only your own rows. Every table in public is behind
-- RLS. Joining a crew needs its invite code, so signing up shows you nothing
-- until someone lets you in.
--
-- Another app of yours can be linked with a link key you create in the app.
-- link_sync() acts for that one user and nobody else.

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
-- session keeps one identity across the app, a linked app and this table.
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  subject text not null check (char_length(btrim(subject)) between 1 and 40),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  location text check (char_length(location) <= 80),
  updated_at timestamptz not null default now(),
  constraint sessions_order check (ended_at > started_at),
  constraint sessions_length check (ended_at - started_at <= interval '16 hours'),
  -- One person can't be in two sessions at once; this holds under concurrency.
  constraint sessions_no_overlap exclude using gist (user_id with =, tstzrange(started_at, ended_at) with &&)
);
create index sessions_user_started_idx on public.sessions (user_id, started_at desc);

-- One row per person: who is studying right now. Stopping clears the row
-- rather than deleting it, because Realtime can't apply RLS to deletes.
-- A pause saves the stretch so far as a session, then keeps the module, the
-- place and the time already saved (banked_seconds) so Resume carries on the
-- same sitting. Studying and being on a break never overlap.
create table public.live (
  user_id uuid primary key default auth.uid() references public.profiles (id) on delete cascade,
  session_id uuid,
  subject text check (char_length(btrim(subject)) between 1 and 40),
  started_at timestamptz,
  location text check (char_length(location) <= 80),
  paused_at timestamptz,
  paused_subject text check (char_length(btrim(paused_subject)) between 1 and 40),
  banked_seconds integer not null default 0 check (banked_seconds >= 0),
  -- What they're playing (through Last.fm), written only by the music edge function (see Music below).
  now_playing jsonb,
  -- When its owner last said "still here" (or edited the timer); see private.hidden_from.
  checked_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint live_shape check ((started_at is null) = (subject is null) and (started_at is null) = (session_id is null)),
  constraint live_pause_shape check ((paused_at is null) = (paused_subject is null) and (paused_at is null or started_at is null))
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

-- Keys for linked apps. Only a SHA-256 of the key is stored; the key itself is
-- shown once, when it's made.
create table public.link_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  label text not null default 'Linked app' check (char_length(btrim(label)) between 1 and 30),
  key_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index link_keys_user_id_idx on public.link_keys (user_id);

/* ------------------------------------------------------------
   Who can see whom
   ------------------------------------------------------------ */

-- SECURITY DEFINER so a policy on crew_members can ask about crew_members
-- without recursing into its own policy. Both answer only about the caller.
create function private.my_crews()
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select crew_id from public.crew_members where user_id = (select auth.uid())
$$;

create function private.shares_crew(other uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select other = (select auth.uid()) or exists (
    select 1
    from public.crew_members mine
    join public.crew_members theirs on theirs.crew_id = mine.crew_id
    where mine.user_id = (select auth.uid()) and theirs.user_id = other
  )
$$;

-- "Still locked in?": when a running timer goes unconfirmed, 3 hours after
-- its stretch started (a switch or a resume counts as touching it) or its
-- owner last said "still here". Null when nothing's running. From then until
-- they answer, crewmates don't see them as live and the board stops counting
-- the timer (private.stats_for); the timer itself keeps running. Matches
-- STILL_THERE_MS in game.mjs.
create function private.hidden_from(p_started timestamptz, p_checked timestamptz)
returns timestamptz
language sql stable set search_path = ''
as $$
  select case when p_started is not null then greatest(p_started, p_checked) + interval '3 hours' end
$$;

-- Postgres grants EXECUTE to PUBLIC on every new function; take that back.
revoke execute on function private.my_crews(), private.shares_crew(uuid), private.hidden_from(timestamptz, timestamptz) from public, anon;
grant execute on function private.my_crews(), private.shares_crew(uuid), private.hidden_from(timestamptz, timestamptz) to authenticated;

/* ------------------------------------------------------------
   Row-level security
   ------------------------------------------------------------ */

alter table public.profiles enable row level security;
alter table public.crews enable row level security;
alter table public.crew_members enable row level security;
alter table public.sessions enable row level security;
alter table public.live enable row level security;
alter table public.pings enable row level security;
alter table public.link_keys enable row level security;


create policy "see yourself and your crewmates" on public.profiles for select to authenticated
  using ((select private.shares_crew(id)));
create policy "create your own profile" on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));
create policy "edit your own profile" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "delete your own profile" on public.profiles for delete to authenticated
  using (id = (select auth.uid()));

create policy "see your crews" on public.crews for select to authenticated
  using (id in (select private.my_crews()));

create policy "see who is in your crews" on public.crew_members for select to authenticated
  using (crew_id in (select private.my_crews()));
create policy "leave a crew" on public.crew_members for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "see your crewmates' sessions" on public.sessions for select to authenticated
  using ((select private.shares_crew(user_id)));
create policy "log your own sessions" on public.sessions for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "edit your own sessions" on public.sessions for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "delete your own sessions" on public.sessions for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "see who is studying" on public.live for select to authenticated
  using ((select private.shares_crew(user_id)));
create policy "start your own timer" on public.live for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "change your own timer" on public.live for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "see pings to and from you" on public.pings for select to authenticated
  using (to_user = (select auth.uid()) or from_user = (select auth.uid()));
create policy "ping a crewmate" on public.pings for insert to authenticated
  with check (from_user = (select auth.uid()) and (select private.shares_crew(to_user)));

create policy "see your own link keys" on public.link_keys for select to authenticated
  using (user_id = (select auth.uid()));
create policy "make your own link keys" on public.link_keys for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "revoke your own link keys" on public.link_keys for delete to authenticated
  using (user_id = (select auth.uid()));

-- The Data API only reaches what these grants allow; RLS then picks the rows.
revoke all on public.profiles, public.crews, public.crew_members, public.sessions, public.live, public.pings, public.link_keys from anon, authenticated;
grant select, insert, update, delete on public.profiles, public.sessions to authenticated;
grant select on public.crews to authenticated;
grant select, delete on public.crew_members to authenticated;
grant select on public.live to authenticated;
-- Every column but now_playing, so nobody can put a fake track on the board.
grant insert (user_id, session_id, subject, started_at, location, paused_at, paused_subject, banked_seconds, checked_at) on public.live to authenticated;
grant update (user_id, session_id, subject, started_at, location, paused_at, paused_subject, banked_seconds, checked_at) on public.live to authenticated;
grant select, insert on public.pings to authenticated;
grant insert, delete on public.link_keys to authenticated;
-- user_id is needed by the delete policy; key_hash is never readable.
grant select (id, user_id, label, created_at, last_used_at) on public.link_keys to authenticated;

/* ------------------------------------------------------------
   Triggers
   ------------------------------------------------------------ */

-- A place is only kept if its owner shares where they study.
create function private.respect_location_sharing()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.location is not null and not coalesce((select share_location from public.profiles where id = new.user_id), false) then
    new.location := null;
  end if;
  new.location := nullif(btrim(new.location), '');
  new.updated_at := now();
  return new;
end $$;
revoke execute on function private.respect_location_sharing() from public, anon, authenticated;

create trigger sessions_location before insert or update on public.sessions
  for each row execute function private.respect_location_sharing();
create trigger live_location before insert or update on public.live
  for each row execute function private.respect_location_sharing();

-- Keeps a break and a running timer apart, whoever writes the row.
create function private.live_pause_rules()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  -- A timer that starts without resuming the break (from a linked app, say) begins a new sitting.
  if new.started_at is not null and new.paused_at is not null then
    new.paused_at := null;
    new.paused_subject := null;
    new.banked_seconds := 0;
  end if;
  -- Nothing running and no break: there's no sitting to carry on.
  if new.started_at is null and new.paused_at is null then
    new.banked_seconds := 0;
  end if;
  -- Music and "still here" only mean anything while you're studying.
  if new.started_at is null then
    new.now_playing := null;
    new.checked_at := null;
  end if;
  -- Nobody can be "still here" in the future.
  if new.checked_at > now() then
    new.checked_at := now();
  end if;
  return new;
end $$;
revoke execute on function private.live_pause_rules() from public, anon, authenticated;
create trigger live_pause before insert or update on public.live
  for each row execute function private.live_pause_rules();

-- Turning sharing off also takes back the places already shared.
create function private.forget_locations()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.sessions set location = null where user_id = new.id and location is not null;
  update public.live set location = null where user_id = new.id and location is not null;
  return new;
end $$;
revoke execute on function private.forget_locations() from public, anon, authenticated;
create trigger profiles_forget_locations after update of share_location on public.profiles
  for each row when (old.share_location and not new.share_location)
  execute function private.forget_locations();

-- Sessions can't be logged in the future (with a minute for clock drift).
create function private.no_future_sessions()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.ended_at > now() + interval '1 minute' then
    raise exception 'A session can''t end in the future.' using errcode = '22023';
  end if;
  if new.started_at < now() - interval '400 days' then
    raise exception 'That session is too long ago to log.' using errcode = '22023';
  end if;
  return new;
end $$;
revoke execute on function private.no_future_sessions() from public, anon, authenticated;
create trigger sessions_not_future before insert or update on public.sessions
  for each row execute function private.no_future_sessions();

-- One ping of each kind per pair every two minutes, so nobody gets spammed.
create function private.throttle_pings()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.pings where from_user = new.from_user and to_user = new.to_user and kind = new.kind and created_at > now() - interval '2 minutes') then
    raise exception 'Easy — you just did that.' using errcode = '22023';
  end if;
  return new;
end $$;
revoke execute on function private.throttle_pings() from public, anon, authenticated;
create trigger pings_throttle before insert on public.pings
  for each row execute function private.throttle_pings();

/* ------------------------------------------------------------
   Crews
   ------------------------------------------------------------ */

-- 32 unambiguous characters (no 0/O, 1/I): eight of them is ~10^12 codes.
create function private.new_crew_code()
returns text
language sql volatile set search_path = ''
as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + (get_byte(b.bytes, i) % 32), 1), '' order by i)
  from (select extensions.gen_random_bytes(8) as bytes) b, generate_series(0, 7) as i
$$;
revoke execute on function private.new_crew_code() from public, anon, authenticated;

-- Creating and joining need to see a crew you aren't in yet, so they run as
-- definer. Each checks the caller itself.
create function public.create_crew(p_name text)
returns public.crews
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_crew public.crews;
begin
  if v_user is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = v_user) then raise exception 'Make your profile first.' using errcode = '42501'; end if;
  if (select count(*) from public.crews where created_by = v_user) >= 10 then raise exception 'You''ve started ten crews already.' using errcode = '22023'; end if;
  insert into public.crews (name, code, created_by) values (btrim(p_name), private.new_crew_code(), v_user) returning * into v_crew;
  insert into public.crew_members (crew_id, user_id) values (v_crew.id, v_user);
  return v_crew;
end $$;

create function public.join_crew(p_code text)
returns public.crews
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_crew public.crews;
begin
  if v_user is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = v_user) then raise exception 'Make your profile first.' using errcode = '42501'; end if;
  select * into v_crew from public.crews where code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  if v_crew.id is null then raise exception 'No crew has that code.' using errcode = 'P0002'; end if;
  if (select count(*) from public.crew_members where crew_id = v_crew.id) >= 50 then raise exception 'That crew is full.' using errcode = '22023'; end if;
  insert into public.crew_members (crew_id, user_id) values (v_crew.id, v_user) on conflict do nothing;
  return v_crew;
end $$;

revoke execute on function public.create_crew(text), public.join_crew(text) from public, anon;
grant execute on function public.create_crew(text), public.join_crew(text) to authenticated;

/* ------------------------------------------------------------
   Stats — one call for the leaderboard, levels and who's live
   ------------------------------------------------------------ */

-- SECURITY INVOKER: from the app it runs under the caller's RLS; from
-- link_sync (definer) the explicit p_user scoping is what limits it.
create function private.stats_for(p_user uuid, p_tz text)
returns table (
  user_id uuid, name text, emoji text,
  live_subject text, live_started_at timestamptz, live_location text,
  total_minutes integer, week_minutes integer, today_minutes integer,
  longest_minutes integer, session_count integer, early_sessions integer, late_sessions integer,
  days jsonb
)
language sql stable set search_path = ''
as $$
  with bounds as (
    select (date_trunc('week', now() at time zone p_tz)) at time zone p_tz as week_start,
           (date_trunc('day', now() at time zone p_tz)) at time zone p_tz as day_start
  ),
  people as (
    select p_user as id
    union
    select theirs.user_id
    from public.crew_members mine
    join public.crew_members theirs on theirs.crew_id = mine.crew_id
    where mine.user_id = p_user
  ),
  timed as (
    select s.user_id, s.started_at, s.ended_at from public.sessions s where s.user_id in (select id from people)
    union all
    -- A running timer counts up to now, or only up to when it went unconfirmed.
    select l.user_id, l.started_at, least(greatest(now(), l.started_at), private.hidden_from(l.started_at, l.checked_at)) from public.live l
    where l.started_at is not null and l.user_id in (select id from people)
  )
  select
    pr.id, pr.name, pr.emoji,
    l.subject, l.started_at, case when pr.share_location then l.location end,
    coalesce((select round(sum(extract(epoch from t.ended_at - t.started_at)) / 60) from timed t where t.user_id = pr.id), 0)::integer,
    coalesce((select round(sum(extract(epoch from least(t.ended_at, now()) - greatest(t.started_at, b.week_start))) / 60) from timed t where t.user_id = pr.id and t.ended_at > b.week_start), 0)::integer,
    coalesce((select round(sum(extract(epoch from least(t.ended_at, now()) - greatest(t.started_at, b.day_start))) / 60) from timed t where t.user_id = pr.id and t.ended_at > b.day_start), 0)::integer,
    coalesce((select round(max(extract(epoch from t.ended_at - t.started_at)) / 60) from timed t where t.user_id = pr.id), 0)::integer,
    (select count(*) from timed t where t.user_id = pr.id)::integer,
    (select count(*) from timed t where t.user_id = pr.id and extract(hour from t.started_at at time zone p_tz) < 8)::integer,
    (select count(*) from timed t where t.user_id = pr.id and extract(hour from t.started_at at time zone p_tz) >= 22)::integer,
    coalesce((
      select jsonb_object_agg(d.day, d.minutes)
      from (
        select to_char(t.started_at at time zone p_tz, 'YYYY-MM-DD') as day, round(sum(extract(epoch from t.ended_at - t.started_at)) / 60)::integer as minutes
        from timed t where t.user_id = pr.id and t.started_at > now() - interval '70 days'
        group by 1
      ) d
    ), '{}'::jsonb)
  from people pe
  join public.profiles pr on pr.id = pe.id
  cross join bounds b
  -- Someone waiting on "still here" shows as live only to themselves.
  left join public.live l on l.user_id = pr.id and l.started_at is not null
    and (pr.id = p_user or private.hidden_from(l.started_at, l.checked_at) > now())
$$;
revoke execute on function private.stats_for(uuid, text) from public, anon;
grant execute on function private.stats_for(uuid, text) to authenticated;

create function public.room_stats(p_tz text default 'Europe/London')
returns table (
  user_id uuid, name text, emoji text,
  live_subject text, live_started_at timestamptz, live_location text,
  total_minutes integer, week_minutes integer, today_minutes integer,
  longest_minutes integer, session_count integer, early_sessions integer, late_sessions integer,
  days jsonb
)
language sql stable security invoker set search_path = ''
as $$
  select * from private.stats_for((select auth.uid()), p_tz)
$$;
revoke execute on function public.room_stats(text) from public, anon;
grant execute on function public.room_stats(text) to authenticated;

/* ------------------------------------------------------------
   Link keys
   ------------------------------------------------------------ */

create function public.create_link_key(p_label text default 'Linked app')
returns text
language plpgsql security invoker set search_path = ''
as $$
declare
  v_key text := 'li_' || encode(extensions.gen_random_bytes(24), 'hex');
begin
  if (select auth.uid()) is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  insert into public.link_keys (user_id, label, key_hash)
  values ((select auth.uid()), coalesce(nullif(btrim(p_label), ''), 'Linked app'), encode(sha256(convert_to(v_key, 'UTF8')), 'hex'));
  return v_key;
end $$;
revoke execute on function public.create_link_key(text) from public, anon;
grant execute on function public.create_link_key(text) to authenticated;

/* ------------------------------------------------------------
   Linked apps
   ------------------------------------------------------------ */

-- Which sessions a linked app wrote. Private: nobody can tell from the
-- shared tables how anyone's time got there.
create table private.linked_sessions (id uuid primary key);
alter table private.linked_sessions enable row level security;
revoke all on private.linked_sessions from public, anon, authenticated;

-- The one call a linked app makes. Applies what it sends for the key's
-- owner (sessions to upsert or remove, and the running timer), then returns
-- that owner's timer, recent sessions and their crew's stats. It runs as
-- definer because a linked app has no user session: the link key is the
-- only authority, and every write is pinned to the key's owner.
create or replace function public.link_sync(p_key text, p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid;
  v_item jsonb;
  v_live jsonb := p_payload->'live';
  v_tz text := coalesce(nullif(p_payload->>'tz', ''), 'Europe/London');
  v_since timestamptz := coalesce((p_payload->>'since')::timestamptz, now() - interval '30 days');
  v_gone uuid[];
  v_skipped jsonb := '[]'::jsonb;
begin
  update public.link_keys set last_used_at = now()
  where key_hash = encode(sha256(convert_to(coalesce(p_key, ''), 'UTF8')), 'hex')
  returning user_id into v_user;
  if v_user is null then raise exception 'That link key isn''t valid. Make a new one in Locked In.' using errcode = '28000'; end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'upsert', '[]'::jsonb)) loop
    begin
      insert into public.sessions as s (id, user_id, subject, started_at, ended_at, location)
      values ((v_item->>'id')::uuid, v_user, btrim(v_item->>'subject'), (v_item->>'started_at')::timestamptz,
              (v_item->>'ended_at')::timestamptz, v_item->>'location')
      on conflict (id) do update
        set subject = excluded.subject, started_at = excluded.started_at, ended_at = excluded.ended_at, location = excluded.location
        where s.user_id = v_user;
      -- FOUND is false when the id belongs to someone else and nothing changed.
      if found and coalesce(v_item->>'origin', 'linked') = 'linked' then
        insert into private.linked_sessions (id) values ((v_item->>'id')::uuid) on conflict do nothing;
      end if;
    exception when others then
      -- One bad session (an overlap, say) mustn't stop the rest syncing.
      v_skipped := v_skipped || jsonb_build_object('id', v_item->>'id', 'reason', sqlerrm);
    end;
  end loop;

  -- Sessions the linked app deleted go here too, only ever the key owner's.
  select coalesce(array_agg(value::uuid), '{}') into v_gone
  from jsonb_array_elements_text(coalesce(p_payload->'delete', '[]'::jsonb));
  delete from public.sessions where user_id = v_user and id = any(v_gone);
  delete from private.linked_sessions k where k.id = any(v_gone) and not exists (select 1 from public.sessions s where s.id = k.id);

  if p_payload ? 'live' then
    if v_live is null or jsonb_typeof(v_live) = 'null' then
      update public.live set session_id = null, subject = null, started_at = null, location = null where user_id = v_user;
    else
      insert into public.live as l (user_id, session_id, subject, started_at, location)
      values (v_user, (v_live->>'session_id')::uuid, btrim(v_live->>'subject'), (v_live->>'started_at')::timestamptz, v_live->>'location')
      on conflict (user_id) do update
        set session_id = excluded.session_id, subject = excluded.subject, started_at = excluded.started_at, location = excluded.location;
      if coalesce(v_live->>'origin', 'linked') = 'linked' then
        insert into private.linked_sessions (id) values ((v_live->>'session_id')::uuid) on conflict do nothing;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'me', (select jsonb_build_object('id', p.id, 'name', p.name, 'emoji', p.emoji, 'share_location', p.share_location) from public.profiles p where p.id = v_user),
    'live', (select jsonb_build_object('session_id', l.session_id, 'subject', l.subject, 'started_at', l.started_at, 'location', l.location,
                                       'origin', case when exists (select 1 from private.linked_sessions k where k.id = l.session_id) then 'linked' else 'app' end)
             from public.live l where l.user_id = v_user and l.started_at is not null),
    'sessions', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'subject', s.subject, 'started_at', s.started_at, 'ended_at', s.ended_at, 'location', s.location, 'updated_at', s.updated_at,
                                                              'origin', case when exists (select 1 from private.linked_sessions k where k.id = s.id) then 'linked' else 'app' end) order by s.started_at)
                          from public.sessions s where s.user_id = v_user and s.started_at >= v_since), '[]'::jsonb),
    'crew', coalesce((select jsonb_agg(to_jsonb(st) - 'days') from private.stats_for(v_user, v_tz) st), '[]'::jsonb),
    'skipped', v_skipped
  );
end $$;
revoke execute on function public.link_sync(text, jsonb) from public;
grant execute on function public.link_sync(text, jsonb) to anon, authenticated;

/* ------------------------------------------------------------
   Realtime, and crews nobody is left in
   ------------------------------------------------------------ */

alter publication supabase_realtime add table public.live, public.sessions, public.pings;
-- Joining a crew and changing your name show up live too. The app listens for
-- inserts and updates only; Realtime can't apply RLS to deletes.
alter publication supabase_realtime add table public.crew_members, public.profiles;

-- A crew with nobody left in it goes too, so its invite code stops working.
create function private.drop_empty_crew()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.crews c
  where c.id = old.crew_id and not exists (select 1 from public.crew_members m where m.crew_id = old.crew_id);
  return null;
end $$;
revoke execute on function private.drop_empty_crew() from public, anon, authenticated;
create trigger crew_members_drop_empty after delete on public.crew_members
  for each row execute function private.drop_empty_crew();

/* ------------------------------------------------------------
   Pairing devices
   ------------------------------------------------------------ */

-- A short code from a device you're signed in on lets another device sign
-- in as you. No email or password. One code per person at a time; it works
-- once and lasts ten minutes. Only its hash is stored.
create table private.pairing_codes (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  code_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz
);
alter table private.pairing_codes enable row level security;
revoke all on private.pairing_codes from public, anon, authenticated;

create function public.create_pairing_code()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_code text;
  v_expires timestamptz := now() + interval '10 minutes';
begin
  if v_user is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = v_user) then raise exception 'Make your profile first.' using errcode = '42501'; end if;
  -- Six of the 32 unambiguous characters: about a billion codes. A clash with
  -- someone else's live code just means drawing again.
  for attempt in 1..5 loop
    select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + (get_byte(b.bytes, i) % 32), 1), '' order by i)
      into v_code
      from (select extensions.gen_random_bytes(6) as bytes) b, generate_series(0, 5) as i;
    begin
      insert into private.pairing_codes (user_id, code_hash, expires_at, used_at)
      values (v_user, encode(sha256(convert_to(v_code, 'UTF8')), 'hex'), v_expires, null)
      on conflict (user_id) do update set code_hash = excluded.code_hash, expires_at = excluded.expires_at, used_at = null;
      return jsonb_build_object('code', v_code, 'expires_at', v_expires);
    exception when unique_violation then
      continue;
    end;
  end loop;
  raise exception 'Couldn''t make a code. Try again.' using errcode = 'P0001';
end $$;
revoke execute on function public.create_pairing_code() from public, anon;
grant execute on function public.create_pairing_code() to authenticated;

-- Only the pair edge function (service role) redeems codes; it then signs
-- the new device in as the code's owner.
create function public.redeem_pairing_code(p_code text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid;
begin
  update private.pairing_codes set used_at = now()
  where code_hash = encode(sha256(convert_to(upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')), 'UTF8')), 'hex')
    and used_at is null and expires_at > now()
  returning user_id into v_user;
  if v_user is null then raise exception 'That code didn''t work. Codes last ten minutes and work once, so make a new one.' using errcode = 'P0002'; end if;
  return v_user;
end $$;
revoke execute on function public.redeem_pairing_code(text) from public, anon, authenticated;
grant execute on function public.redeem_pairing_code(text) to service_role;

/* ------------------------------------------------------------
   Modules: each person's own list
   ------------------------------------------------------------ */

-- Nothing is assumed; you add yours. Private to you. Sessions keep the
-- module's name, so the board and feed are unchanged.
create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  -- A colour slot, fixed when the module is added, so it never changes meaning.
  color smallint not null default 0 check (color between 0 and 7),
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index subjects_user_name_idx on public.subjects (user_id, lower(btrim(name)));

alter table public.subjects enable row level security;
create policy "see your own modules" on public.subjects for select to authenticated
  using (user_id = (select auth.uid()));
create policy "add your own modules" on public.subjects for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "change your own modules" on public.subjects for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.subjects from anon, authenticated;
grant select, insert, update on public.subjects to authenticated;

-- The next colour slot for a person: the first unused, then round again.
create function private.next_subject_color(p_user uuid)
returns smallint
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select min(slot) from generate_series(0, 7) as slot where slot not in (select color from public.subjects where user_id = p_user and not archived)),
    ((select count(*) from public.subjects where user_id = p_user) % 8)
  )::smallint
$$;
revoke execute on function private.next_subject_color(uuid) from public, anon;
grant execute on function private.next_subject_color(uuid) to authenticated;

create function private.subject_color_default()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then new.color := private.next_subject_color(new.user_id); end if;
  new.name := btrim(new.name);
  return new;
end $$;
revoke execute on function private.subject_color_default() from public, anon, authenticated;
create trigger subjects_defaults before insert or update on public.subjects
  for each row execute function private.subject_color_default();

-- Anything you study becomes one of your modules, wherever the timer ran,
-- so a session from another device or a linked app joins the list.
create function private.remember_subject()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.subject is not null then
    insert into public.subjects (user_id, name) values (new.user_id, btrim(new.subject))
    on conflict (user_id, (lower(btrim(name)))) do nothing;
  end if;
  return new;
end $$;
revoke execute on function private.remember_subject() from public, anon, authenticated;
create trigger sessions_remember_subject after insert or update of subject on public.sessions
  for each row execute function private.remember_subject();
create trigger live_remember_subject after insert or update of subject on public.live
  for each row execute function private.remember_subject();

-- A module added by mistake can go, as long as no time was ever logged to it.
-- Anything with history is archived instead, so its hours keep their name.
create function private.subject_unused(p_user uuid, p_name text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select not exists (select 1 from public.sessions where user_id = p_user and lower(btrim(subject)) = lower(btrim(p_name)))
     and not exists (select 1 from public.live where user_id = p_user and lower(btrim(subject)) = lower(btrim(p_name)))
$$;
revoke execute on function private.subject_unused(uuid, text) from public, anon;
grant execute on function private.subject_unused(uuid, text) to authenticated;
create policy "remove your own unused modules" on public.subjects for delete to authenticated
  using (user_id = (select auth.uid()) and (select private.subject_unused(user_id, name)));
grant delete on public.subjects to authenticated;

-- Renaming a module renames your past sessions with it, so its hours stay together.
create function public.rename_subject(p_id uuid, p_name text)
returns public.subjects
language plpgsql security invoker set search_path = ''
as $$
declare
  v_old text;
  v_row public.subjects;
begin
  select name into v_old from public.subjects where id = p_id and user_id = (select auth.uid());
  if v_old is null then raise exception 'That module no longer exists.' using errcode = 'P0002'; end if;
  begin
    update public.subjects set name = p_name where id = p_id returning * into v_row;
  exception when unique_violation then
    raise exception 'You already have a module called %.', btrim(p_name) using errcode = '23505';
  end;
  update public.sessions set subject = v_row.name where user_id = (select auth.uid()) and lower(btrim(subject)) = lower(v_old);
  update public.live set subject = v_row.name where user_id = (select auth.uid()) and lower(btrim(subject)) = lower(v_old);
  return v_row;
end $$;
revoke execute on function public.rename_subject(uuid, text) from public, anon;
grant execute on function public.rename_subject(uuid, text) to authenticated;

-- Hours per module, for your own breakdown: this week and all time.
create function public.my_subject_stats(p_tz text default 'Europe/London')
returns table (subject_id uuid, name text, color smallint, archived boolean, week_minutes integer, total_minutes integer, last_studied timestamptz)
language sql stable security invoker set search_path = ''
as $$
  with bounds as (select (date_trunc('week', now() at time zone p_tz)) at time zone p_tz as week_start),
  timed as (
    select s.subject, s.started_at, s.ended_at from public.sessions s where s.user_id = (select auth.uid())
    union all
    select l.subject, l.started_at, greatest(now(), l.started_at) from public.live l where l.user_id = (select auth.uid()) and l.started_at is not null
  )
  select m.id, m.name, m.color, m.archived,
    coalesce((select round(sum(extract(epoch from least(t.ended_at, now()) - greatest(t.started_at, b.week_start))) / 60) from timed t where lower(btrim(t.subject)) = lower(m.name) and t.ended_at > b.week_start), 0)::integer,
    coalesce((select round(sum(extract(epoch from t.ended_at - t.started_at)) / 60) from timed t where lower(btrim(t.subject)) = lower(m.name)), 0)::integer,
    (select max(t.ended_at) from timed t where lower(btrim(t.subject)) = lower(m.name))
  from public.subjects m cross join bounds b
  where m.user_id = (select auth.uid())
  order by m.archived, m.created_at
$$;
revoke execute on function public.my_subject_stats(text) from public, anon;
grant execute on function public.my_subject_stats(text) to authenticated;

/* ------------------------------------------------------------
   Music: what you're playing, shown to your crew while you're locked
   in. It comes through Last.fm, which Spotify reports to, so anyone
   can link their own account. The music edge function checks the
   name you link and writes live.now_playing every 30 s.
   (Replaced the Spotify sign-in on 2026-10-27; its tables were
   dropped by hand in the SQL editor, so that isn't in migrations.)
   ------------------------------------------------------------ */

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Whose Last.fm to ask. Only the edge function, through the service-role functions below, reads it.
create table private.music_links (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  lastfm text,
  linked_at timestamptz not null default now(),
  polled_at timestamptz not null default 'epoch',
  problem text
);
-- One Locked In account per Last.fm account.
create unique index music_links_lastfm on private.music_links (lower(lastfm));
-- When everyone was last checked, so the sweep runs at most every 20 seconds whoever calls it.
create table private.music_sweep (
  id integer primary key default 1 check (id = 1),
  last_at timestamptz not null default 'epoch'
);
insert into private.music_sweep default values;
alter table private.music_links enable row level security;
alter table private.music_sweep enable row level security;
revoke all on private.music_links, private.music_sweep from public, anon, authenticated;

-- Link (or relink) someone's Last.fm. False when another account already has it.
create function public.music_link(p_user uuid, p_lastfm text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  insert into private.music_links as m (user_id, lastfm, polled_at) values (p_user, p_lastfm, now())
  on conflict (user_id) do update set lastfm = excluded.lastfm, linked_at = now(), polled_at = now(), problem = null;
  return true;
exception when unique_violation then
  return false;
end $$;

-- Who to ask Last.fm about: everyone locked in with a working link (a sweep,
-- at most every 20 seconds), or one person right now. Claiming sets polled_at,
-- so overlapping calls never ask twice.
create function public.music_claim(p_user uuid default null)
returns table (user_id uuid, lastfm text)
language plpgsql security definer set search_path = ''
as $$
begin
  if p_user is null then
    update private.music_sweep set last_at = now() where id = 1 and last_at < now() - interval '20 seconds';
    if not found then return; end if;
  end if;
  return query
    with claimed as (
      update private.music_links m set polled_at = now()
      from public.live l
      where l.user_id = m.user_id and l.started_at is not null and m.lastfm is not null and m.problem is null
        and (p_user is null or m.user_id = p_user)
        and m.polled_at < now() - interval '8 seconds'
      returning m.user_id, m.lastfm
    )
    select c.user_id, c.lastfm from claimed c;
end $$;

-- After asking Last.fm: what's playing (null for nothing), or a problem the person has to fix.
create function public.music_save(p_user uuid, p_now_playing jsonb, p_problem text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_problem is not null then
    update private.music_links set problem = p_problem where music_links.user_id = p_user;
  end if;
  update public.live set now_playing = p_now_playing
  where live.user_id = p_user and live.started_at is not null and live.now_playing is distinct from p_now_playing;
end $$;

create function public.music_unlink(p_user uuid)
returns void
language sql security definer set search_path = ''
as $$
  update private.music_links set lastfm = null, problem = null where user_id = p_user;
  update public.live set now_playing = null where user_id = p_user;
$$;

revoke execute on function public.music_link(uuid, text), public.music_claim(uuid),
  public.music_save(uuid, jsonb, text), public.music_unlink(uuid) from public, anon, authenticated;
grant execute on function public.music_link(uuid, text), public.music_claim(uuid),
  public.music_save(uuid, jsonb, text), public.music_unlink(uuid) to service_role;

-- For the app: which Last.fm you've linked, and is anything wrong?
create function public.my_music()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('connected', m.lastfm is not null, 'lastfm', m.lastfm, 'problem', m.problem)
     from private.music_links m where m.user_id = (select auth.uid())),
    jsonb_build_object('connected', false, 'lastfm', null, 'problem', null));
$$;
revoke execute on function public.my_music() from public, anon;
grant execute on function public.my_music() to authenticated;

-- Every 30 seconds, but only calls out while someone linked is locked in.
select cron.schedule('locked-in-music', '30 seconds', $job$
  select net.http_post(
    url := 'https://dmuzyednlvftkoxqhzed.supabase.co/functions/v1/music',
    body := '{"action":"sweep"}'::jsonb,
    headers := '{"content-type":"application/json"}'::jsonb)
  where exists (
    select 1 from public.live l join private.music_links m on m.user_id = l.user_id
    where l.started_at is not null and m.lastfm is not null and m.problem is null)
$job$);
