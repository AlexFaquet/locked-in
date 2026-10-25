-- Who can see whom: yourself and anyone who shares a crew with you.

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

-- Postgres grants EXECUTE to PUBLIC on every new function; take that back.
revoke execute on function private.my_crews(), private.shares_crew(uuid) from public, anon;
grant execute on function private.my_crews(), private.shares_crew(uuid) to authenticated;

/* ------------------------------------------------------------
   Row-level security
   ------------------------------------------------------------ */


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
grant select, insert, update on public.live to authenticated;
grant select, insert on public.pings to authenticated;
grant insert, delete on public.link_keys to authenticated;
-- user_id is needed by the delete policy; key_hash is never readable.
grant select (id, user_id, label, created_at, last_used_at) on public.link_keys to authenticated;
