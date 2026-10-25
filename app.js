// Locked In — one page, three tabs, Supabase for everything.
//
// Accounts are anonymous: a name and an emoji, kept in this browser. What
// you can see is decided by the database (you, and whoever shares a crew
// with you), so this file never filters anything for privacy.

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";
import { levelProgress, streakFrom, badgesFor, standings, chaseLine, hm, clock, untilReset, ago, localDay, encodeAlfredCode } from "./game.mjs";

const db = createClient(SUPABASE_URL, SUPABASE_KEY);
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/London";
const EMOJI = ["📚", "🦊", "🐼", "🐸", "🦉", "🐯", "🐙", "🦄", "🐧", "🐨", "🦁", "🐵", "🐳", "🌵", "🍄", "⚡️", "🚀", "🎧", "☕️", "🧠"];
const MIN_SESSION_MS = 60000;
const MAX_SESSION_MS = 16 * 3600000;
const JOIN_KEY = "lockedin.join";
const TAB_KEY = "lockedin.tab";

const state = {
  user: null, me: null, crews: [], people: [], live: null, feed: [], mine: [], keys: [],
  tab: readStored(TAB_KEY) || "now", board: "week", subject: "", place: "",
};
let channel = null;
let refreshTimer = null;

/* ------------------------------------------------------------
   Small helpers — every string goes in as text, never markup
   ------------------------------------------------------------ */

function h(tag, props, ...kids) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "style") Object.assign(node.style, value);
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) node.append(kid instanceof Node ? kid : String(kid));
  return node;
}
function readStored(key) { try { return localStorage.getItem(key); } catch (_) { return null; } }
function store(key, value) { try { localStorage.setItem(key, value); } catch (_) {} }
const byId = (id) => state.people.find((p) => p.user_id === id);
const nameOf = (id) => byId(id)?.name || "Someone";
const minutesBetween = (a, b) => (+new Date(b) - +new Date(a)) / 60000;
const timeOf = (iso) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const inviteLink = (code) => `${location.origin}${location.pathname}?join=${code}`;

function toast(text, { bad = false, ms = 3800 } = {}) {
  const node = h("div", { class: `toast${bad ? " bad" : ""}` }, text);
  document.getElementById("toasts").append(node);
  setTimeout(() => node.remove(), ms);
}
function oops(error, fallback = "That didn't work. Try again?") {
  console.warn(error);
  toast(error?.message || fallback, { bad: true, ms: 5500 });
}
function notify(text) {
  toast(text, { ms: 6000 });
  if (document.hidden && "Notification" in window && Notification.permission === "granted") {
    try { new Notification("Locked In", { body: text, icon: "icon-180.png" }); } catch (_) {}
  }
}
async function copy(text, done = "Copied!") {
  try { await navigator.clipboard.writeText(text); toast(done); }
  catch (_) { prompt("Copy this:", text); }
}
function confetti(symbols = ["🎉", "⭐️", "🔥", "📚", "✨"]) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const layer = h("div", { class: "confetti", "aria-hidden": "true" });
  for (let i = 0; i < 28; i++) {
    layer.append(h("span", { style: { left: `${Math.random() * 100}%`, animationDelay: `${Math.random() * 0.35}s` }, dataset: {} }, symbols[i % symbols.length]));
    const s = layer.lastChild;
    s.style.setProperty("--dx", `${(Math.random() - 0.5) * 160}px`);
    s.style.setProperty("--r", `${(Math.random() - 0.5) * 720}deg`);
    s.style.setProperty("--t", `${1.3 + Math.random() * 0.9}s`);
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 2600);
}

/** A bottom sheet. `build(box, close)` fills it. */
function sheet(build) {
  const box = h("div", { class: "sheet", role: "dialog", "aria-modal": "true" });
  const back = h("div", { class: "sheet-back", onclick: (ev) => { if (ev.target === back) close(); } }, box);
  const onKey = (ev) => { if (ev.key === "Escape") close(); };
  function close() { back.remove(); document.removeEventListener("keydown", onKey); }
  document.addEventListener("keydown", onKey);
  build(box, close);
  document.body.append(back);
  box.querySelector("input, button")?.focus();
  return close;
}

function emojiPicker(current, onPick) {
  return h("div", { class: "emoji-grid", role: "group", "aria-label": "Pick your emoji" },
    EMOJI.map((e) => h("button", { type: "button", class: "emoji-pick", "aria-pressed": String(e === current), "aria-label": e, onclick: (ev) => {
      ev.currentTarget.parentNode.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === ev.currentTarget)));
      onPick(e);
    } }, e)));
}

/** Re-rendering mustn't throw away what someone is halfway through typing. */
function keepFocus(paint) {
  const active = document.activeElement;
  const id = active?.id;
  const caret = id && "selectionStart" in active ? [active.selectionStart, active.selectionEnd] : null;
  paint();
  if (!id) return;
  const again = document.getElementById(id);
  if (!again) return;
  again.focus({ preventScroll: true });
  if (caret) try { again.setSelectionRange(...caret); } catch (_) {}
}

/* ------------------------------------------------------------
   Getting in: a name, an emoji, a crew
   ------------------------------------------------------------ */

function welcome() {
  let emoji = EMOJI[Math.floor(Math.random() * EMOJI.length)];
  const name = h("input", { id: "w-name", class: "input", maxlength: 24, placeholder: "e.g. Alex", autocomplete: "nickname", required: true });
  const go = h("button", { class: "btn btn-big btn-block", type: "submit" }, "Let's go →");
  const invited = readJoin();
  app().replaceChildren(h("main", { class: "welcome" },
    h("div", { class: "welcome-lock", "aria-hidden": "true" }, "🔒"),
    h("h1", null, "Locked In"),
    h("p", null, invited ? "You've been invited to a study crew. Who's joining?" : "Study with your friends. See who's locked in, race the weekly board, keep your streak alive."),
    h("form", { class: "step card", onsubmit: async (ev) => {
      ev.preventDefault();
      go.disabled = true;
      try {
        if (!state.user) {
          const { data, error } = await db.auth.signInAnonymously();
          if (error) throw error;
          state.user = data.user;
        }
        const { data, error } = await db.from("profiles").insert({ id: state.user.id, name: name.value.trim(), emoji }).select().single();
        if (error) throw error;
        state.me = data;
        await afterProfile();
      } catch (error) { oops(error); go.disabled = false; }
    } },
      h("label", { class: "label", for: "w-name" }, "What should your crew call you?"), name,
      h("span", { class: "label", style: { marginTop: "20px" } }, "Pick your emoji"),
      emojiPicker(emoji, (e) => { emoji = e; }),
      h("div", { style: { marginTop: "24px" } }, go)),
    h("p", { class: "small muted", style: { marginTop: "18px" } }, "No email or password. Your account lives in this browser — add Locked In to your home screen so you keep it.")));
  name.focus();
}

const readJoin = () => { try { return sessionStorage.getItem(JOIN_KEY); } catch (_) { return null; } };
const clearJoin = () => { try { sessionStorage.removeItem(JOIN_KEY); } catch (_) {} };

function crewStep() {
  const code = h("input", { id: "c-code", class: "input", maxlength: 12, placeholder: "ABCD2345", autocapitalize: "characters", autocomplete: "off", value: readJoin() || "" });
  const crewName = h("input", { id: "c-name", class: "input", maxlength: 40, placeholder: "Library Gremlins" });
  app().replaceChildren(h("main", { class: "welcome" },
    h("div", { class: "welcome-lock", "aria-hidden": "true" }, state.me.emoji),
    h("h1", null, `Hey ${state.me.name}!`),
    h("p", null, "Find your crew. You'll only ever see the people in it."),
    h("div", { class: "step card" },
      h("form", { onsubmit: (ev) => { ev.preventDefault(); joinCrew(code.value); } },
        h("label", { class: "label", for: "c-code" }, "Got an invite code?"),
        h("div", { class: "row" }, code, h("button", { class: "btn", type: "submit" }, "Join"))),
      h("div", { class: "or" }, "or"),
      h("form", { onsubmit: (ev) => { ev.preventDefault(); createCrew(crewName.value); } },
        h("label", { class: "label", for: "c-name" }, "Start a new crew"),
        h("div", { class: "row" }, crewName, h("button", { class: "btn btn-gold", type: "submit" }, "Start"))))));
}

async function joinCrew(code) {
  const { data, error } = await db.rpc("join_crew", { p_code: code });
  if (error) return oops(error);
  clearJoin();
  toast(`Welcome to ${data.name}! 🎉`);
  confetti();
  await enter();
}

async function createCrew(name) {
  if (!name.trim()) return toast("Give your crew a name first.", { bad: true });
  const { data, error } = await db.rpc("create_crew", { p_name: name });
  if (error) return oops(error);
  await enter();
  shareInvite(data);
}

function shareInvite(crew) {
  sheet((box, close) => box.append(
    h("h2", null, `${crew.name} is ready 🎉`),
    h("p", { class: "muted", style: { marginTop: "6px" } }, "Send your friends this link, or the code."),
    h("p", { class: "code", style: { marginTop: "18px" } }, crew.code),
    h("div", { class: "btn-row" },
      h("button", { class: "btn btn-soft", onclick: () => copy(crew.code, "Code copied!") }, "Copy code"),
      h("button", { class: "btn", onclick: async () => {
        const url = inviteLink(crew.code);
        if (navigator.share) { try { await navigator.share({ title: "Locked In", text: `Join ${crew.name} on Locked In and let's race the study board 🔒`, url }); } catch (_) {} }
        else copy(url, "Invite link copied!");
      } }, "Share invite")),
    h("button", { class: "link", style: { marginTop: "12px" }, onclick: close }, "Done")));
}

/* ------------------------------------------------------------
   Loading
   ------------------------------------------------------------ */

const app = () => document.getElementById("app");

async function boot() {
  const join = new URLSearchParams(location.search).get("join");
  if (join) {
    try { sessionStorage.setItem(JOIN_KEY, join.toUpperCase()); } catch (_) {}
    history.replaceState({}, "", location.pathname);
  }
  const { data } = await db.auth.getSession();
  state.user = data.session?.user || null;
  if (!state.user) return welcome();
  const { data: me, error } = await db.from("profiles").select("*").eq("id", state.user.id).maybeSingle();
  if (error) return oops(error);
  state.me = me;
  if (!me) return welcome();
  await afterProfile();
}

async function afterProfile() {
  await loadCrews();
  const pending = readJoin();
  if (pending && !state.crews.some((c) => c.code === pending)) return joinCrew(pending);
  if (!state.crews.length) return crewStep();
  await enter();
}

async function enter() {
  await refresh();
  subscribe();
  render();
  scrollTo({ top: 0 });
}

async function loadCrews() {
  const { data, error } = await db.from("crews").select("id, name, code, created_by, crew_members(count)").order("created_at");
  if (error) return oops(error);
  state.crews = (data || []).map((c) => ({ ...c, members: c.crew_members?.[0]?.count || 1 }));
}

async function refresh() {
  const uid = state.user.id;
  const [stats, live, feed, mine, keys] = await Promise.all([
    db.rpc("room_stats", { p_tz: TZ }),
    db.from("live").select("*").eq("user_id", uid).maybeSingle(),
    db.from("sessions").select("id, user_id, subject, started_at, ended_at, location").order("ended_at", { ascending: false }).limit(25),
    db.from("sessions").select("id, subject, started_at, ended_at, location, origin").eq("user_id", uid).order("started_at", { ascending: false }).limit(40),
    db.from("link_keys").select("id, label, created_at, last_used_at").order("created_at"),
    loadCrews(),
  ]);
  const failed = [stats, live, feed, mine, keys].find((r) => r.error);
  if (failed) return oops(failed.error, "Couldn't load your crew.");
  state.people = stats.data || [];
  state.live = live.data?.started_at ? live.data : null;
  state.feed = feed.data || [];
  state.mine = mine.data || [];
  state.keys = keys.data || [];
}

function refreshSoon() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => { await refresh(); keepFocus(render); }, 400);
}

/* ------------------------------------------------------------
   Realtime: who just locked in, and pings
   ------------------------------------------------------------ */

function subscribe() {
  if (channel) db.removeChannel(channel);
  channel = db.channel("crew")
    .on("postgres_changes", { event: "*", schema: "public", table: "live" }, ({ new: row }) => {
      const before = row?.user_id && byId(row.user_id);
      if (row?.started_at && row.user_id !== state.user.id && before && !before.live_started_at) {
        notify(`${before.emoji} ${before.name} just locked in on ${row.subject}${row.location ? ` at ${row.location}` : ""}`);
      }
      refreshSoon();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "sessions" }, refreshSoon)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "pings", filter: `to_user=eq.${state.user.id}` }, ({ new: ping }) => {
      const who = byId(ping.from_user);
      notify(ping.kind === "joining" ? `🏃 ${who?.name || "Someone"} is on the way to join you!` : `🔥 ${who?.name || "Someone"} is cheering you on!`);
    })
    .subscribe();
}

/* ------------------------------------------------------------
   The timer
   ------------------------------------------------------------ */

async function lockIn() {
  const subject = state.subject.trim();
  if (!subject) return toast("What are you studying? Add a subject first.", { bad: true });
  const row = { user_id: state.user.id, session_id: crypto.randomUUID(), subject, started_at: new Date().toISOString(), location: state.place.trim() || null, origin: "app" };
  const { error } = await db.from("live").upsert(row, { onConflict: "user_id" });
  if (error) return oops(error);
  state.live = row;
  render();
  scrollTo({ top: 0, behavior: "smooth" });
  refreshSoon();
}

/** Stops the timer. Under a minute isn't kept; past 16 hours we ask when you really stopped. */
async function finish({ discard = false, end = new Date() } = {}) {
  const live = state.live;
  if (!live) return;
  const length = +end - +new Date(live.started_at);
  if (!discard && length > MAX_SESSION_MS) return askWhenStopped();
  const levelBefore = levelProgress(byId(state.user.id)?.total_minutes || 0).level;
  if (!discard && length >= MIN_SESSION_MS) {
    const { error } = await db.from("sessions").insert({ id: live.session_id, user_id: state.user.id, subject: live.subject, started_at: live.started_at, ended_at: end.toISOString(), location: live.location, origin: "app" });
    if (error) return oops(error);
  }
  const { error } = await db.from("live").update({ session_id: null, subject: null, started_at: null, location: null, origin: null }).eq("user_id", state.user.id);
  if (error) return oops(error);
  state.live = null;
  await refresh();
  render();
  const minutes = length / 60000;
  const after = levelProgress(byId(state.user.id)?.total_minutes || 0);
  if (discard || length < MIN_SESSION_MS) toast(discard ? "Timer cancelled." : "Under a minute — not counted.");
  else if (after.level > levelBefore) { confetti(["⭐️", "🎉", "🏆", "✨"]); toast(`Level up! You're Level ${after.level} — ${after.title} 🏆`, { ms: 6000 }); }
  else { if (minutes >= 25) confetti(); toast(`+${Math.round(minutes)} XP · ${hm(minutes)} on ${live.subject} 💪`); }
}

function askWhenStopped() {
  const start = new Date(state.live.started_at);
  const day = h("input", { class: "input", type: "date", value: localDay(start), max: localDay(new Date()) });
  const time = h("input", { class: "input", type: "time", value: timeOf(new Date(+start + 2 * 3600000)) });
  sheet((box, close) => box.append(
    h("h2", null, "That's a long one 😅"),
    h("p", { class: "muted", style: { marginTop: "6px" } }, `You've been locked in since ${start.toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })}. When did you actually stop?`),
    h("div", { class: "row", style: { marginTop: "16px" } }, day, time),
    h("div", { class: "btn-row" },
      h("button", { class: "btn btn-soft", onclick: () => { close(); finish({ discard: true }); } }, "Throw it away"),
      h("button", { class: "btn", onclick: () => { close(); finish({ end: new Date(`${day.value}T${time.value}:00`) }); } }, "Save"))));
}

/* ------------------------------------------------------------
   Painting
   ------------------------------------------------------------ */

function render() {
  const me = byId(state.user.id);
  const streak = streakFrom(me?.days || {});
  const level = levelProgress(me?.total_minutes || 0);
  const liveOthers = state.people.filter((p) => p.live_started_at && p.user_id !== state.user.id).length;
  const tab = (key, icon, label) => h("button", { class: "tab", "aria-current": state.tab === key ? "page" : null, onclick: () => { state.tab = key; store(TAB_KEY, key); render(); scrollTo({ top: 0 }); } },
    h("b", { class: key === "now" && liveOthers ? "tab-dot" : null, dataset: key === "now" && liveOthers ? { count: liveOthers } : {} }, icon), label);
  const views = { now: nowView, board: boardView, me: meView };
  app().replaceChildren(
    h("header", { class: "top" },
      h("div", { class: "brand" }, h("span", { class: "brand-lock", "aria-hidden": "true" }, "🔒"), "Locked In"),
      h("div", { class: "top-stats" },
        h("span", { class: "pill pill-flame", title: "Days in a row with 30+ minutes" }, "🔥 ", String(streak)),
        h("span", { class: "pill pill-level", title: level.title }, "Lv ", String(level.level)))),
    h("main", null, (views[state.tab] || nowView)()),
    h("nav", { class: "tabs", "aria-label": "Sections" }, tab("now", "⏱️", "Now"), tab("board", "🏆", "Board"), tab("me", state.me.emoji, "Me")));
  tick();
}

function nowView() {
  const others = state.people.filter((p) => p.live_started_at && p.user_id !== state.user.id)
    .sort((a, b) => +new Date(a.live_started_at) - +new Date(b.live_started_at));
  const me = byId(state.user.id);
  const crewToday = state.people.reduce((sum, p) => sum + p.today_minutes, 0);
  return [
    state.live ? runningCard() : startCard(),
    h("section", { class: "section" },
      h("div", { class: "section-head" }, h("h2", null, "Locked in right now"), h("small", null, others.length ? `${others.length} studying` : "")),
      others.length ? others.map(liveCard) : h("div", { class: "card empty" }, h("span", { class: "big" }, "🦗"), state.live ? "Just you. Lead by example." : "Nobody's locked in. Be the first.")),
    h("section", { class: "section today" },
      h("div", { class: "stat" }, h("span", null, "You today"), h("strong", null, hm(me?.today_minutes || 0))),
      h("div", { class: "stat" }, h("span", null, "Crew today"), h("strong", null, hm(crewToday)))),
  ];
}

function startCard() {
  const subjects = [...new Set(state.mine.map((s) => s.subject))].slice(0, 6);
  if (!state.subject && subjects[0]) state.subject = subjects[0];
  const places = [...new Set(state.mine.map((s) => s.location).filter(Boolean))].slice(0, 6);
  const subject = h("input", { id: "subject", class: "input", maxlength: 40, placeholder: "MT3501, essay, flashcards…", value: state.subject, oninput: (ev) => { state.subject = ev.target.value; paintChips(); } });
  const chips = h("div", { class: "chips" });
  function paintChips() {
    chips.replaceChildren(...subjects.map((s) => h("button", { type: "button", class: "chip", "aria-pressed": String(s === state.subject.trim()), onclick: () => { state.subject = s; subject.value = s; paintChips(); } }, s)));
  }
  paintChips();
  const place = h("input", { id: "place", class: "input", maxlength: 80, placeholder: "Main Library, café, home…", list: "places", value: state.place, oninput: (ev) => { state.place = ev.target.value; } });
  return h("form", { class: "card timer-card", onsubmit: (ev) => { ev.preventDefault(); lockIn(); } },
    h("h2", null, "What are you locking in on?"),
    subjects.length ? chips : null,
    h("label", { class: "field" }, h("span", { class: "label" }, "Subject"), subject),
    state.me.share_location
      ? h("label", { class: "field" }, h("span", { class: "label" }, "Where (your crew sees this)"), place, h("datalist", { id: "places" }, places.map((p) => h("option", { value: p }))))
      : h("p", { class: "small muted", style: { marginTop: "12px" } }, "Location sharing is off — turn it on in Me if you want friends to find you."),
    h("button", { class: "btn btn-big btn-live btn-block", type: "submit", style: { marginTop: "20px" } }, "🔒 Lock in"));
}

function runningCard() {
  const live = state.live;
  return h("section", { class: "card running" },
    h("span", { class: "running-tag" }, "LOCKED IN"),
    h("h2", null, live.subject),
    h("div", { class: "big-clock", dataset: { since: live.started_at } }, clock(Date.now() - +new Date(live.started_at))),
    h("div", { class: "xp-tick" }, "⭐️ +", h("span", { dataset: { xpSince: live.started_at } }, "0"), " XP"),
    live.location ? h("p", { class: "running-where" }, "📍 ", live.location) : null,
    live.origin === "alfred" ? h("p", { class: "small muted", style: { marginTop: "6px" } }, "Started from Alfred") : null,
    h("button", { class: "btn btn-big btn-block", onclick: () => finish() }, "✓ Done"),
    h("div", { class: "running-foot" }, h("button", { class: "link", onclick: () => finish({ discard: true }) }, "Cancel without saving")));
}

function liveCard(p) {
  const ping = async (kind) => {
    const { error } = await db.from("pings").insert({ to_user: p.user_id, kind });
    if (error) return oops(error);
    toast(kind === "joining" ? `Told ${p.name} you're coming 🏃` : `Sent ${p.name} some fire 🔥`);
  };
  return h("article", { class: "card live-card" },
    h("span", { class: "avatar is-live", "aria-hidden": "true" }, p.emoji),
    h("div", { class: "live-who" },
      h("strong", null, p.name), " ", h("span", { class: "live-clock", dataset: { since: p.live_started_at } }, clock(Date.now() - +new Date(p.live_started_at))),
      h("p", null, p.live_subject, p.live_location ? ` · 📍 ${p.live_location}` : "")),
    h("div", { class: "live-actions" },
      p.live_location ? h("button", { class: "btn btn-small btn-live", onclick: () => ping("joining") }, "🏃 I'm coming") : null,
      h("button", { class: "btn btn-small btn-soft", onclick: () => ping("cheer") }, "🔥 Hype")));
}

function boardView() {
  const key = state.board === "week" ? "week_minutes" : "total_minutes";
  const ranked = standings(state.people, key);
  const chase = chaseLine(ranked, state.user.id, key);
  const leader = Math.max(1, ...ranked.map((p) => p[key]));
  const spot = (p, place) => p
    ? h("div", { class: `podium-spot ${place}` }, h("span", { class: `avatar${p.live_started_at ? " is-live" : ""}` }, p.emoji), h("span", { class: "podium-name" }, p.name), h("span", { class: "podium-time" }, hm(p[key])),
      h("div", { class: "podium-block" }, place === "first" ? "1" : place === "second" ? "2" : "3"))
    : h("div", { class: `podium-spot ${place} empty-spot` }, h("span", { class: "avatar" }, "?"), h("span", { class: "podium-name" }, "—"), h("div", { class: "podium-block" }));
  const crewTotal = ranked.reduce((sum, p) => sum + p[key], 0);
  return [
    h("section", { class: "card" },
      h("div", { class: "board-head" },
        h("div", { class: "toggle", role: "group", "aria-label": "Period" },
          ...[["week", "This week"], ["all", "All time"]].map(([k, label]) => h("button", { "aria-pressed": String(state.board === k), onclick: () => { state.board = k; render(); } }, label))),
        h("span", { class: "reset" }, state.board === "week" ? `Resets in ${untilReset()}` : `${hm(crewTotal)} together`)),
      h("div", { class: "podium" }, spot(ranked[1], "second"), spot(ranked[0], "first"), spot(ranked[2], "third")),
      chase ? h("div", { class: "chase" }, h("span", { "aria-hidden": "true" }, "🎯"), h("span", null, chase)) : null,
      h("ol", { class: "ranks" }, ranked.map((p) => h("li", { class: `rank-row${p.user_id === state.user.id ? " is-me" : ""}` },
        h("span", { class: "rank-num" }, String(p.rank)),
        h("span", { class: `avatar${p.live_started_at ? " is-live" : ""}`, "aria-hidden": "true" }, p.emoji),
        h("div", { class: "rank-main" },
          h("strong", null, h("span", null, p.name), p.live_started_at ? h("i", { class: "live-dot", title: "Locked in now" }) : null, p.streak ? h("em", { class: "flame" }, `🔥${p.streak}`) : null),
          h("div", { class: "rank-bar" }, h("span", { style: { width: `${Math.max(3, (p[key] / leader) * 100)}%` } }))),
        h("span", { class: "rank-time" }, hm(p[key])))))),
    state.board === "week" ? h("p", { class: "small muted", style: { textAlign: "center", margin: "12px 0 0" } }, `Crew total this week: ${hm(crewTotal)}`) : null,
    h("section", { class: "section" },
      h("div", { class: "section-head" }, h("h2", null, "Recent sessions")),
      h("div", { class: "card" }, state.feed.length ? state.feed.map((s) => {
        const p = byId(s.user_id);
        return h("div", { class: "feed-row" }, h("span", { class: "avatar", "aria-hidden": "true" }, p?.emoji || "📚"),
          h("div", null, h("p", null, `${p?.name || "Someone"} · ${s.subject}`), h("small", null, [s.location ? `📍 ${s.location}` : null, ago(s.ended_at)].filter(Boolean).join(" · "))),
          h("span", { class: "feed-time" }, hm(minutesBetween(s.started_at, s.ended_at))));
      }) : h("p", { class: "empty" }, "Finished sessions show up here."))),
  ];
}

function meView() {
  const me = byId(state.user.id) || { total_minutes: 0, week_minutes: 0, longest_minutes: 0, session_count: 0, early_sessions: 0, late_sessions: 0, days: {} };
  const streak = streakFrom(me.days);
  const level = levelProgress(me.total_minutes);
  const badges = badgesFor(me, streak);
  return [
    h("section", { class: "card hero" },
      h("span", { class: "avatar avatar-big" }, state.me.emoji),
      h("h2", null, state.me.name),
      h("p", { class: "hero-title" }, `Level ${level.level} · ${level.title}`),
      h("div", { class: "xp" },
        h("div", { class: "xp-top" }, h("span", null, `${Math.round(me.total_minutes)} XP`), h("span", null, `${hm(level.toNext)} to Level ${level.level + 1}`)),
        h("div", { class: "xp-bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(Math.round(level.ratio * 100)) }, h("span", { style: { width: `${Math.max(2, level.ratio * 100)}%` } }))),
      h("div", { class: "hero-stats" },
        h("div", null, h("strong", null, `🔥 ${streak}`), h("span", null, "Day streak")),
        h("div", null, h("strong", null, hm(me.total_minutes)), h("span", null, "All time")),
        h("div", null, h("strong", null, hm(me.longest_minutes)), h("span", null, "Longest")))),
    h("section", { class: "section" }, h("div", { class: "section-head" }, h("h2", null, "Last 10 weeks")), h("div", { class: "card" }, heatmap(me.days))),
    h("section", { class: "section" },
      h("div", { class: "section-head" }, h("h2", null, "Badges"), h("small", null, `${badges.filter((b) => b.got).length}/${badges.length}`)),
      h("div", { class: "badges" }, badges.map((b) => h("div", { class: `badge ${b.got ? "got" : "locked"}`, title: b.detail }, h("b", { "aria-hidden": "true" }, b.icon), h("strong", null, b.name), h("small", null, b.detail))))),
    h("section", { class: "section" },
      h("div", { class: "section-head" }, h("h2", null, "Your sessions"), h("button", { class: "btn btn-small btn-soft", onclick: logSession }, "+ Log one")),
      h("div", { class: "card" }, state.mine.length ? state.mine.slice(0, 20).map((s) => h("div", { class: "session-row" },
        h("div", null, h("p", null, s.subject), h("small", null, [`${new Date(s.started_at).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} ${timeOf(s.started_at)}–${timeOf(s.ended_at)}`, s.location, s.origin === "alfred" ? "via Alfred" : null].filter(Boolean).join(" · "))),
        h("strong", { class: "feed-time" }, hm(minutesBetween(s.started_at, s.ended_at))),
        h("button", { class: "x", "aria-label": `Delete ${s.subject} session`, onclick: () => removeSession(s) }, "✕"))) : h("p", { class: "empty" }, "Your sessions show up here."))),
    settingsCard(),
  ];
}

function heatmap(days = {}) {
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - ((today.getDay() + 6) % 7) - 63);
  const cells = [];
  for (let i = 0; i < 70; i++) {
    const day = new Date(start); day.setDate(start.getDate() + i);
    const minutes = days[localDay(day)] || 0;
    const future = day > today;
    const level = future ? null : minutes >= 240 ? 4 : minutes >= 120 ? 3 : minutes >= 30 ? 2 : minutes > 0 ? 1 : 0;
    cells.push(h("span", { class: localDay(day) === localDay(today) ? "is-today" : null, dataset: level == null ? {} : { level }, title: future ? "" : `${day.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}: ${hm(minutes)}`, style: future ? { visibility: "hidden" } : {} }));
  }
  return [h("div", { class: "heat", role: "img", "aria-label": "Study per day over the last ten weeks" }, cells),
    h("div", { class: "heat-legend" }, h("span", null, "Mon → Sun, oldest week left"), h("span", null, "darker = more"))];
}

function settingsCard() {
  const share = h("input", { type: "checkbox", class: "switch", checked: state.me.share_location, "aria-label": "Share where you study", onchange: async (ev) => {
    const { data, error } = await db.from("profiles").update({ share_location: ev.target.checked }).eq("id", state.user.id).select().single();
    if (error) { ev.target.checked = !ev.target.checked; return oops(error); }
    state.me = data;
    toast(data.share_location ? "Your crew can see where you study." : "Location hidden — and past places wiped.");
    refreshSoon();
  } });
  const canNotify = "Notification" in window;
  return h("section", { class: "section" },
    h("div", { class: "section-head" }, h("h2", null, "Settings")),
    h("div", { class: "card" },
      h("div", { class: "setting" }, h("div", null, h("strong", null, `${state.me.emoji} ${state.me.name}`), h("small", null, "Your name and emoji")), h("button", { class: "btn btn-small btn-soft", onclick: editProfile }, "Edit")),
      h("div", { class: "setting" }, h("div", null, h("strong", null, "Share where I study"), h("small", null, "So friends can come and join you")), share),
      canNotify ? h("div", { class: "setting" }, h("div", null, h("strong", null, "Notifications"), h("small", null, Notification.permission === "granted" ? "On while Locked In is open" : "When a friend locks in or pings you")),
        Notification.permission === "granted" ? h("span", { class: "pill" }, "✓ On") : h("button", { class: "btn btn-small btn-soft", onclick: async () => { await Notification.requestPermission(); render(); } }, "Turn on")) : null),
    h("div", { class: "section-head", style: { marginTop: "26px" } }, h("h2", null, "Crews"), h("button", { class: "btn btn-small btn-soft", onclick: crewSheet }, "+ Join / start")),
    h("div", { class: "card" }, state.crews.map((c) => h("div", { class: "crew-row" },
      h("div", null, h("strong", null, c.name), h("p", { class: "small muted" }, `${c.members} ${c.members === 1 ? "member" : "members"} · code `, h("b", null, c.code))),
      h("div", { class: "crew-actions" },
        h("button", { class: "btn btn-small", onclick: () => shareInvite(c) }, "Invite"),
        h("button", { class: "link", onclick: () => leaveCrew(c) }, "Leave"))))),
    h("div", { class: "section-head", style: { marginTop: "26px" } }, h("h2", null, "Alfred")),
    h("div", { class: "card" },
      h("p", { class: "small" }, "Connect Alfred to sync your timers both ways and let Alfred see your crew. Only you can link your own account."),
      state.keys.map((k) => h("div", { class: "setting" }, h("div", null, h("strong", null, k.label), h("small", null, k.last_used_at ? `Last synced ${ago(k.last_used_at)}` : "Not used yet")),
        h("button", { class: "link", onclick: () => revokeKey(k) }, "Disconnect"))),
      h("button", { class: "btn btn-small btn-soft", style: { marginTop: "12px" }, onclick: makeAlfredCode }, state.keys.length ? "Make a new code" : "Connect Alfred")),
    h("div", { class: "card", style: { marginTop: "16px" } },
      h("p", { class: "small muted" }, "Your account lives in this browser. Clearing site data or switching phones starts a new one — add Locked In to your home screen (Share → Add to Home Screen) so it sticks."),
      h("button", { class: "link", style: { color: "var(--danger)", marginTop: "8px" }, onclick: deleteEverything }, "Delete my account and sessions")));
}

/* ------------------------------------------------------------
   Sheets
   ------------------------------------------------------------ */

function editProfile() {
  let emoji = state.me.emoji;
  const name = h("input", { class: "input", maxlength: 24, value: state.me.name });
  sheet((box, close) => box.append(
    h("h2", null, "You"),
    h("label", { class: "field" }, h("span", { class: "label" }, "Name"), name),
    h("span", { class: "label", style: { marginTop: "16px" } }, "Emoji"),
    emojiPicker(emoji, (e) => { emoji = e; }),
    h("div", { class: "btn-row" }, h("button", { class: "btn btn-soft", onclick: close }, "Cancel"),
      h("button", { class: "btn", onclick: async () => {
        const { data, error } = await db.from("profiles").update({ name: name.value.trim(), emoji }).eq("id", state.user.id).select().single();
        if (error) return oops(error);
        state.me = data; close(); await refresh(); render(); toast("Looking good ✨");
      } }, "Save"))));
}

function crewSheet() {
  const code = h("input", { class: "input", maxlength: 12, placeholder: "Invite code", autocapitalize: "characters" });
  const crewName = h("input", { class: "input", maxlength: 40, placeholder: "New crew name" });
  sheet((box, close) => box.append(
    h("h2", null, "Another crew"),
    h("div", { class: "row", style: { marginTop: "16px" } }, code, h("button", { class: "btn", onclick: () => { close(); joinCrew(code.value); } }, "Join")),
    h("div", { class: "or" }, "or"),
    h("div", { class: "row" }, crewName, h("button", { class: "btn btn-gold", onclick: () => { close(); createCrew(crewName.value); } }, "Start"))));
}

async function leaveCrew(crew) {
  if (!confirm(`Leave ${crew.name}? You can rejoin with the code ${crew.code}.`)) return;
  const { error } = await db.from("crew_members").delete().eq("crew_id", crew.id).eq("user_id", state.user.id);
  if (error) return oops(error);
  await loadCrews();
  if (!state.crews.length) return crewStep();
  await refresh(); render();
}

function logSession() {
  const subjects = [...new Set(state.mine.map((s) => s.subject))];
  const now = new Date();
  const subject = h("input", { class: "input", maxlength: 40, placeholder: "Subject", list: "log-subjects", value: subjects[0] || "" });
  const day = h("input", { class: "input", type: "date", value: localDay(now), max: localDay(now) });
  const from = h("input", { class: "input", type: "time", value: timeOf(new Date(+now - 3600000)) });
  const to = h("input", { class: "input", type: "time", value: timeOf(now) });
  sheet((box, close) => box.append(
    h("h2", null, "Log a session"),
    h("p", { class: "muted", style: { marginTop: "4px" } }, "For when you forgot to lock in."),
    h("label", { class: "field" }, h("span", { class: "label" }, "Subject"), subject, h("datalist", { id: "log-subjects" }, subjects.map((s) => h("option", { value: s })))),
    h("div", { class: "form-grid", style: { marginTop: "14px" } }, day, from, to),
    h("div", { class: "btn-row" }, h("button", { class: "btn btn-soft", onclick: close }, "Cancel"),
      h("button", { class: "btn", onclick: async () => {
        const start = new Date(`${day.value}T${from.value}:00`);
        let end = new Date(`${day.value}T${to.value}:00`);
        if (end <= start) end.setDate(end.getDate() + 1);
        const { error } = await db.from("sessions").insert({ user_id: state.user.id, subject: subject.value.trim(), started_at: start.toISOString(), ended_at: end.toISOString(), origin: "app" });
        if (error) return oops(error.message.includes("sessions_no_overlap") ? { message: "That overlaps a session you already have." } : error);
        close(); await refresh(); render(); toast(`+${Math.round((end - start) / 60000)} XP logged ⭐️`);
      } }, "Save"))));
}

async function removeSession(session) {
  if (!confirm(`Delete ${session.subject} (${hm(minutesBetween(session.started_at, session.ended_at))})? It comes off the board too.`)) return;
  const { error } = await db.from("sessions").delete().eq("id", session.id);
  if (error) return oops(error);
  await refresh(); render();
}

async function makeAlfredCode() {
  const { data: link, error } = await db.rpc("create_link_key", { p_label: "Alfred" });
  if (error) return oops(error);
  const code = encodeAlfredCode({ url: SUPABASE_URL, key: SUPABASE_KEY, link });
  await refresh(); render();
  sheet((box, close) => box.append(
    h("h2", null, "Your Alfred code 🤖"),
    h("p", { class: "muted", style: { marginTop: "6px" } }, "Paste it into Alfred → Study → Locked In. It's shown once — anyone with it can log time as you, so keep it to yourself."),
    h("div", { class: "code-box" }, code),
    h("div", { class: "btn-row" }, h("button", { class: "btn btn-soft", onclick: close }, "Done"), h("button", { class: "btn", onclick: () => copy(code, "Code copied — paste it into Alfred.") }, "Copy code"))));
}

async function revokeKey(key) {
  if (!confirm("Disconnect this Alfred? It stops syncing straight away.")) return;
  const { error } = await db.from("link_keys").delete().eq("id", key.id);
  if (error) return oops(error);
  await refresh(); render();
}

async function deleteEverything() {
  if (!confirm("Delete your account, every session and your place on the board? This can't be undone.")) return;
  const { error } = await db.from("profiles").delete().eq("id", state.user.id);
  if (error) return oops(error);
  await db.auth.signOut();
  location.reload();
}

/* ------------------------------------------------------------
   The clock: only the numbers move, once a second
   ------------------------------------------------------------ */

function tick() {
  const now = Date.now();
  for (const node of document.querySelectorAll("[data-since]")) node.textContent = clock(now - +new Date(node.dataset.since));
  for (const node of document.querySelectorAll("[data-xp-since]")) node.textContent = String(Math.floor((now - +new Date(node.dataset.xpSince)) / 60000));
}
setInterval(() => { if (!document.hidden) tick(); }, 1000);
document.addEventListener("visibilitychange", () => { if (!document.hidden && state.me && state.crews.length) refreshSoon(); });

boot().catch((error) => {
  console.error(error);
  app().replaceChildren(h("main", { class: "welcome" }, h("div", { class: "welcome-lock" }, "😵"), h("h1", null, "Couldn't connect"), h("p", null, error.message || "Check your connection and reload.")));
});
