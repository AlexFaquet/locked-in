// The whole of supabase/schema.sql in an in-process Postgres (PGlite), with
// just enough of Supabase around it (auth.uid(), the roles, Realtime's
// publication, pg_cron) to load. Lets a test sign in as anyone and see what
// the database lets them do, without touching the real project.

import { readFileSync } from "node:fs";

const SCHEMA = new URL("../../supabase/schema.sql", import.meta.url);

/** Null when PGlite isn't installed (npm install), so the rest of the tests still run. */
export async function startDatabase() {
  let PGlite, btree_gist, pgcrypto;
  try {
    ({ PGlite } = await import("@electric-sql/pglite"));
    ({ btree_gist } = await import("@electric-sql/pglite/contrib/btree_gist"));
    ({ pgcrypto } = await import("@electric-sql/pglite/contrib/pgcrypto"));
  } catch (_) {
    return null;
  }
  const db = new PGlite({ extensions: { btree_gist, pgcrypto } });
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema extensions;
    create extension pgcrypto with schema extensions;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    -- Who's signed in: set per query by as() below.
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    grant usage on schema auth, extensions to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    create publication supabase_realtime;
    -- pg_cron and pg_net aren't here; a job is just remembered.
    create schema cron;
    create table cron.jobs (name text primary key, schedule text, command text);
    create function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint language sql as $$
      insert into cron.jobs values (p_name, p_schedule, p_command) on conflict (name) do update set schedule = excluded.schedule, command = excluded.command returning 1::bigint $$;
  `);
  const schema = readFileSync(SCHEMA, "utf8").replace(/^create extension if not exists (pg_cron|pg_net)\b[^;]*;$/gm, "-- $&");
  await db.exec(schema);
  return db;
}

/** Runs `sql` as `uid` (signed in), or as someone with no account when `uid` is null. */
export async function as(db, uid, sql, params) {
  await db.exec(`reset role; select set_config('test.uid', '${uid || ""}', false); set role ${uid ? "authenticated" : "anon"};`);
  try { return await db.query(sql, params); } finally { await db.exec("reset role; select set_config('test.uid', '', false);"); }
}

/** A person with an account and a profile. */
export async function person(db, id, name) {
  await db.query("insert into auth.users (id) values ($1)", [id]);
  await db.query("insert into public.profiles (id, name) values ($1, $2)", [id, name]);
}
