-- Rules every write obeys, whoever makes it.

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
