-- Crews, stats for the leaderboard, and Alfred link keys.

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
    select l.user_id, l.started_at, greatest(now(), l.started_at) from public.live l
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
  left join public.live l on l.user_id = pr.id and l.started_at is not null
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
   Alfred
   ------------------------------------------------------------ */

create function public.create_link_key(p_label text default 'Alfred')
returns text
language plpgsql security invoker set search_path = ''
as $$
declare
  v_key text := 'li_' || encode(extensions.gen_random_bytes(24), 'hex');
begin
  if (select auth.uid()) is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  insert into public.link_keys (user_id, label, key_hash)
  values ((select auth.uid()), coalesce(nullif(btrim(p_label), ''), 'Alfred'), encode(sha256(convert_to(v_key, 'UTF8')), 'hex'));
  return v_key;
end $$;
revoke execute on function public.create_link_key(text) from public, anon;
grant execute on function public.create_link_key(text) to authenticated;
