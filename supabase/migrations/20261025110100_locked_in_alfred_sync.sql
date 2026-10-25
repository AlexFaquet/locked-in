-- Alfred's sync call, and Realtime.
--
-- The Supabase MCP tool refuses any migration containing DELETE, so this one
-- was run by hand in the dashboard's SQL editor (Database → SQL Editor).
-- It isn't in the project's migration history for that reason.

-- Alfred's one call. Applies what Alfred sends for its owner — sessions to
-- upsert or delete, and the running timer — then returns that owner's live
-- timer, recent sessions and their crew's stats. It runs as definer because
-- Alfred has no user session; the link key is the only authority, and every
-- write is pinned to the key's owner.
create function public.link_sync(p_key text, p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid;
  v_item jsonb;
  v_live jsonb := p_payload->'live';
  v_tz text := coalesce(nullif(p_payload->>'tz', ''), 'Europe/London');
  v_since timestamptz := coalesce((p_payload->>'since')::timestamptz, now() - interval '30 days');
  v_skipped jsonb := '[]'::jsonb;
begin
  update public.link_keys set last_used_at = now()
  where key_hash = encode(sha256(convert_to(coalesce(p_key, ''), 'UTF8')), 'hex')
  returning user_id into v_user;
  if v_user is null then raise exception 'That link key isn''t valid. Make a new one in Locked In.' using errcode = '28000'; end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'upsert', '[]'::jsonb)) loop
    begin
      insert into public.sessions as s (id, user_id, subject, started_at, ended_at, location, origin)
      values ((v_item->>'id')::uuid, v_user, btrim(v_item->>'subject'), (v_item->>'started_at')::timestamptz,
              (v_item->>'ended_at')::timestamptz, v_item->>'location', coalesce(v_item->>'origin', 'alfred'))
      on conflict (id) do update
        set subject = excluded.subject, started_at = excluded.started_at, ended_at = excluded.ended_at, location = excluded.location
        where s.user_id = v_user;
    exception when others then
      -- One bad session (an overlap, say) mustn't stop the rest syncing.
      v_skipped := v_skipped || jsonb_build_object('id', v_item->>'id', 'reason', sqlerrm);
    end;
  end loop;

  delete from public.sessions
  where user_id = v_user
    and id in (select value::uuid from jsonb_array_elements_text(coalesce(p_payload->'delete', '[]'::jsonb)));

  if p_payload ? 'live' then
    if v_live is null or jsonb_typeof(v_live) = 'null' then
      update public.live set session_id = null, subject = null, started_at = null, location = null, origin = null where user_id = v_user;
    else
      insert into public.live as l (user_id, session_id, subject, started_at, location, origin)
      values (v_user, (v_live->>'session_id')::uuid, btrim(v_live->>'subject'), (v_live->>'started_at')::timestamptz, v_live->>'location', coalesce(v_live->>'origin', 'alfred'))
      on conflict (user_id) do update
        set session_id = excluded.session_id, subject = excluded.subject, started_at = excluded.started_at, location = excluded.location, origin = excluded.origin;
    end if;
  end if;

  return jsonb_build_object(
    'me', (select jsonb_build_object('id', p.id, 'name', p.name, 'emoji', p.emoji, 'share_location', p.share_location) from public.profiles p where p.id = v_user),
    'live', (select jsonb_build_object('session_id', l.session_id, 'subject', l.subject, 'started_at', l.started_at, 'location', l.location, 'origin', l.origin)
             from public.live l where l.user_id = v_user and l.started_at is not null),
    'sessions', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'subject', s.subject, 'started_at', s.started_at, 'ended_at', s.ended_at, 'location', s.location, 'origin', s.origin) order by s.started_at)
                          from public.sessions s where s.user_id = v_user and s.started_at >= v_since), '[]'::jsonb),
    'crew', coalesce((select jsonb_agg(to_jsonb(st) - 'days') from private.stats_for(v_user, v_tz) st), '[]'::jsonb),
    'skipped', v_skipped
  );
end $$;
revoke execute on function public.link_sync(text, jsonb) from public;
grant execute on function public.link_sync(text, jsonb) to anon, authenticated;

/* ------------------------------------------------------------
   Realtime
   ------------------------------------------------------------ */

alter publication supabase_realtime add table public.live, public.sessions, public.pings;
