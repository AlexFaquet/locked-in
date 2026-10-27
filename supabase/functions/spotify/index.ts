// Spotify: what people in a crew are listening to while they're locked in.
//
// Spotify's sign-in comes back here, not to the app: an app added to an
// iPhone's home screen can't receive it (the sign-in opens in a separate
// browser). This function swaps the code for tokens and keeps them, so the
// app never handles a token, and checks everyone who's locked in every 30
// seconds (pg_cron), writing what's playing to their live row.
//
//   POST {action:"start"}        signed in: the Spotify sign-in address
//   GET  ?code=…&state=…         where Spotify sends people back
//   POST {action:"now"}          signed in: check your track straight away
//   POST {action:"disconnect"}   signed in: forget your Spotify
//   POST {action:"sweep"}        the 30-second job; at most once per 20
//                                seconds whoever calls it, so it's public
import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import { nowPlaying } from "./playing.ts";

// The Spotify app's Client ID. Public by design: this sign-in (PKCE) needs no secret.
const CLIENT_ID = "a35d1dba25a641118f9d363e5cdf449b";
const APP_URL = "https://alexfaquet.github.io/locked-in/";
// Must match the Redirect URI saved in the Spotify app exactly.
const SELF = "https://dmuzyednlvftkoxqhzed.supabase.co/functions/v1/spotify";
const SCOPE = "user-read-currently-playing";
const PLAYING = "https://api.spotify.com/v1/me/player/currently-playing?additional_types=episode";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, apikey, authorization, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });
// Supabase serves HTML from functions as plain text, so the sign-in ends back in the app.
const backToApp = (result: string) => Response.redirect(`${APP_URL}?spotify=${result}`, 302);

/** The project's secret key: the new kind if there is one, the legacy service-role key otherwise. */
function secretKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    if (keys.default) return keys.default;
  } catch (_) { /* fall back to the legacy key */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}
const admin = createClient(Deno.env.get("SUPABASE_URL")!, secretKey(), { auth: { persistSession: false, autoRefreshToken: false } });

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const random = (n: number) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const challenge = async (verifier: string) => b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));

async function signedIn(req: Request): Promise<string | null> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  return error ? null : data.user?.id ?? null;
}

async function tokenCall(params: Record<string, string>) {
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, ...params }),
  });
  return { ok: res.ok, body: await res.json().catch(() => ({})) };
}

type Tokens = { access_token: string; refresh_token: string | null; expires_at: string; connected?: boolean };
const tokensFrom = (body: { access_token: string; refresh_token?: string; expires_in: number }): Tokens => ({
  access_token: body.access_token,
  refresh_token: body.refresh_token ?? null,
  expires_at: new Date(Date.now() + body.expires_in * 1000).toISOString(),
});

const NOT_LISTED = "Spotify hasn't let this account in yet. Ask whoever runs Locked In to add the email you use for Spotify.";
const SIGNED_OUT = "Spotify signed you out (it does every six months). Connect again.";

async function store(user: string, tokens: Tokens | null, playing: unknown, problem: string | null = null, setPlaying = true) {
  const { error } = await admin.rpc("music_store", { p_user: user, p_tokens: tokens, p_now_playing: playing, p_problem: problem, p_set_playing: setPlaying });
  if (error) console.error("spotify: store failed", error.message);
}

type Link = { user_id: string; refresh_token: string; access_token: string | null; expires_at: string | null };

/** Ask Spotify what one person is playing, refreshing their access first if it's (nearly) expired. */
async function check(link: Link) {
  let fresh: Tokens | null = null;
  let access = link.access_token;
  if (!access || !link.expires_at || Date.parse(link.expires_at) < Date.now() + 60_000) {
    const r = await tokenCall({ grant_type: "refresh_token", refresh_token: link.refresh_token });
    if (!r.ok) {
      if (r.body?.error === "invalid_grant") return store(link.user_id, null, null, SIGNED_OUT);
      return;   // Spotify's having a moment; the next sweep tries again
    }
    fresh = tokensFrom(r.body);
    access = fresh.access_token;
  }
  const res = await fetch(PLAYING, { headers: { authorization: `Bearer ${access}` } });
  if (res.status === 204) return store(link.user_id, fresh, null);
  if (res.status === 403) return store(link.user_id, null, null, NOT_LISTED);
  // Expired early: drop it, so the next check refreshes.
  if (res.status === 401) return store(link.user_id, { access_token: "", refresh_token: null, expires_at: new Date(0).toISOString() }, null, null, false);
  if (!res.ok) { if (fresh) await store(link.user_id, fresh, null, null, false); return; }
  return store(link.user_id, fresh, nowPlaying(await res.json().catch(() => null)));
}

async function due(user: string | null): Promise<Link[]> {
  const { data, error } = await admin.rpc("music_due", { p_user: user });
  if (error) { console.error("spotify: due failed", error.message); return []; }
  return data ?? [];
}

/** Spotify sends people back here after they agree (or don't). */
async function signInReturned(url: URL): Promise<Response> {
  if (url.searchParams.get("error")) return backToApp("cancelled");
  const { data } = await admin.rpc("music_redeem", { p_state: url.searchParams.get("state") ?? "" });
  const pending = data?.[0];
  if (!pending) return backToApp("expired");
  const r = await tokenCall({ grant_type: "authorization_code", code: url.searchParams.get("code") ?? "", redirect_uri: SELF, code_verifier: pending.verifier });
  if (!r.ok) { console.error("spotify: code exchange failed", r.body?.error); return backToApp("failed"); }
  const tokens = { ...tokensFrom(r.body), connected: true };
  // Spotify lets anyone sign in but refuses accounts that aren't on the app's list, so look once now.
  const probe = await fetch(PLAYING, { headers: { authorization: `Bearer ${tokens.access_token}` } });
  if (probe.status === 403) return backToApp("not-listed");
  await store(pending.user_id, tokens, probe.status === 200 ? nowPlaying(await probe.json().catch(() => null)) : null);
  return backToApp("connected");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (!CLIENT_ID) return json({ error: "Spotify isn't set up for Locked In yet." }, 503);
  const url = new URL(req.url);
  if (req.method === "GET") return signInReturned(url);
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  let action = "";
  try { action = String((await req.json())?.action ?? ""); } catch (_) { return json({ error: "Send an action." }, 400); }

  if (action === "sweep") {
    const links = await due(null);
    await Promise.all(links.map(check));
    return json({ checked: links.length });
  }

  const user = await signedIn(req);
  if (!user) return json({ error: "Sign in to Locked In first." }, 401);

  if (action === "start") {
    const state = random(24);
    const verifier = random(48);
    const { error } = await admin.rpc("music_begin", { p_user: user, p_state: state, p_verifier: verifier });
    if (error) { console.error("spotify: begin failed", error.message); return json({ error: "Spotify can't be connected right now. Try again in a minute." }, 500); }
    const signIn = new URL("https://accounts.spotify.com/authorize");
    signIn.search = new URLSearchParams({
      client_id: CLIENT_ID, response_type: "code", redirect_uri: SELF, scope: SCOPE,
      code_challenge_method: "S256", code_challenge: await challenge(verifier), state,
    }).toString();
    return json({ url: signIn.toString() });
  }
  if (action === "now") {
    await Promise.all((await due(user)).map(check));
    return json({ ok: true });
  }
  if (action === "disconnect") {
    const { error } = await admin.rpc("music_disconnect", { p_user: user });
    if (error) return json({ error: "Couldn't disconnect Spotify. Try again." }, 500);
    return json({ ok: true });
  }
  return json({ error: "Unknown action." }, 400);
});
