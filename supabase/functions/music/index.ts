// Music: what people in a crew are listening to while they're locked in.
//
// It comes through Last.fm, which Spotify (and most music apps) can report
// to, so anyone can link their own account without being added anywhere.
// This function checks the Last.fm name someone gives, then every 30 seconds
// (pg_cron) asks Last.fm what everyone locked in is playing and writes it to
// their live row. The app never writes a track itself.
//
//   POST {action:"link", name}  signed in: link your Last.fm account
//   POST {action:"now"}         signed in: check your track straight away
//   POST {action:"unlink"}      signed in: stop showing your music
//   POST {action:"sweep"}       the 30-second job; at most once per 20
//                               seconds whoever calls it, so it's public
import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import { lastfmName, nowPlaying } from "./lastfm.ts";

// The API key from last.fm/api/account/create, kept as this function's LASTFM_KEY secret.
const KEY = Deno.env.get("LASTFM_KEY") ?? "";
const APP_URL = "https://alexfaquet.github.io/locked-in/";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, apikey, authorization, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

/** The project's secret key: the new kind if there is one, the legacy service-role key otherwise. */
function secretKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    if (keys.default) return keys.default;
  } catch (_) { /* fall back to the legacy key */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}
const admin = createClient(Deno.env.get("SUPABASE_URL")!, secretKey(), { auth: { persistSession: false, autoRefreshToken: false } });

async function signedIn(req: Request): Promise<string | null> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  return error ? null : data.user?.id ?? null;
}

// Last.fm's answers that need the person to do something.
const NO_SUCH_USER = 6;
const PRIVATE_LISTENING = 17;
const PRIVATE = "Your Last.fm listening is private. Turn off “Hide recent listening” in Last.fm's privacy settings, then link it again.";

/** Someone's latest track, with the one playing now (if any) first. Null if Last.fm can't be reached. */
// deno-lint-ignore no-explicit-any
async function recent(name: string): Promise<any> {
  const url = new URL("https://ws.audioscrobbler.com/2.0/");
  url.search = new URLSearchParams({ method: "user.getrecenttracks", user: name, limit: "1", api_key: KEY, format: "json" }).toString();
  try {
    const res = await fetch(url, { headers: { "user-agent": `Locked In (${APP_URL})` } });
    return await res.json();
  } catch (_) {
    return null;
  }
}

async function store(user: string, playing: unknown, problem: string | null = null) {
  const { error } = await admin.rpc("music_save", { p_user: user, p_now_playing: playing, p_problem: problem });
  if (error) console.error("music: store failed", error.message);
}

type Link = { user_id: string; lastfm: string };

async function check(link: Link) {
  const reply = await recent(link.lastfm);
  if (reply?.error === NO_SUCH_USER) return store(link.user_id, null, `Last.fm can't find ${link.lastfm} any more. Link your account again.`);
  if (reply?.error === PRIVATE_LISTENING) return store(link.user_id, null, PRIVATE);
  if (!reply?.recenttracks) {
    // Last.fm's having a moment; the next sweep tries again.
    if (reply?.error) console.error("music: last.fm said", reply.error, reply.message);
    return;
  }
  return store(link.user_id, nowPlaying(reply));
}

async function due(user: string | null): Promise<Link[]> {
  const { data, error } = await admin.rpc("music_claim", { p_user: user });
  if (error) { console.error("music: claim failed", error.message); return []; }
  return data ?? [];
}

async function link(user: string, typed: unknown): Promise<Response> {
  const name = lastfmName(typed);
  if (!name) return json({ error: "That doesn't look like a Last.fm username. It's the name at the end of your Last.fm profile's link." }, 400);
  const reply = await recent(name);
  if (reply?.error === NO_SUCH_USER) return json({ error: `Last.fm has no one called ${name}. Check the spelling: it's the name at the end of your Last.fm profile's link.` }, 400);
  if (reply?.error === PRIVATE_LISTENING) return json({ error: PRIVATE }, 400);
  if (!reply?.recenttracks) {
    console.error("music: last.fm said", reply?.error, reply?.message);
    return json({ error: "Last.fm isn't answering right now. Try again in a minute." }, 503);
  }
  const about = reply.recenttracks["@attr"] ?? {};
  const exact = String(about.user || name);
  const { data: linked, error } = await admin.rpc("music_link", { p_user: user, p_lastfm: exact });
  if (error) { console.error("music: link failed", error.message); return json({ error: "Couldn't link Last.fm. Try again." }, 500); }
  if (!linked) return json({ error: `${exact} is already linked to someone else on Locked In.` }, 409);
  await store(user, nowPlaying(reply));
  // No scrobbles yet usually means Spotify isn't connected to Last.fm.
  return json({ name: exact, scrobbles: Number(about.total) || 0 });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = await req.json(); } catch (_) { return json({ error: "Send an action." }, 400); }
  const action = String(body?.action ?? "");

  if (action === "sweep") {
    if (!KEY) return json({ checked: 0 });
    const links = await due(null);
    await Promise.all(links.map(check));
    return json({ checked: links.length });
  }

  const user = await signedIn(req);
  if (!user) return json({ error: "Sign in to Locked In first." }, 401);

  if (action === "unlink") {
    const { error } = await admin.rpc("music_unlink", { p_user: user });
    if (error) return json({ error: "Couldn't unlink Last.fm. Try again." }, 500);
    return json({ ok: true });
  }
  if (!KEY) return json({ error: "Music isn't set up for Locked In yet. Try again later." }, 503);
  if (action === "link") return link(user, body.name);
  if (action === "now") {
    await Promise.all((await due(user)).map(check));
    return json({ ok: true });
  }
  return json({ error: "Unknown action." }, 400);
});
