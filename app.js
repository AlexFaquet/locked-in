// Locked In — one page, three tabs, Supabase for everything.
//
// Accounts are anonymous: a name and an emoji, kept in this browser. What
// you can see is decided by the database (you, and whoever shares a crew
// with you), so this file never filters anything for privacy.

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm";
import { SUPABASE_URL, SUPABASE_KEY, MUSIC } from "./config.js";
import { levelProgress, streakFrom, badgesFor, standings, chaseLine, hm, clock, untilReset, ago, TZ, ukDay, ukAt, dayStart, encodeLinkCode, weekStart, weeksFrom, subjectsBetween, hourTicks, shortHours, sittingMs, onBreak, BREAK_KEPT_MS, BREAK_SHOWN_MS, hiddenFrom, unconfirmed } from "./game.mjs";

const db = createClient(SUPABASE_URL, SUPABASE_KEY);
const EMOJI = ["📚", "🦊", "🐼", "🐸", "🦉", "🐯", "🐙", "🦄", "🐧", "🐨", "🦁", "🐵", "🐳", "🌵", "🍄", "⚡️", "🚀", "🎧", "☕️", "🧠"];
const MIN_SESSION_MS = 60000;
const MAX_SESSION_MS = 16 * 3600000;
const JOIN_KEY = "lockedin.join";
const TAB_KEY = "lockedin.tab";
const BOARD_KEY = "lockedin.board";
// Linking another app is for whoever asks for it: open the app once with
// ?link and that browser shows the option. Nobody else sees it.
const LINKING_KEY = "lockedin.linking";
const SKIPPED_MODULES_KEY = "lockedin.skippedModules";
const ACTIVITY_KEY = "lockedin.activityView";

const state = {
  user: null, me: null, crews: [], people: [], live: null, paused: null, breaks: [], liveRows: new Map(), music: null, feed: [], mine: [], keys: [], watchers: [], modules: [],
  // On a watch link's page: what it last loaded. Read-only, and "you" means the person who shared it.
  watching: null,
  tab: readStored(TAB_KEY) || "now", board: readStored(BOARD_KEY) || "week", subject: "", place: "",
};
let channel = null;
let refreshTimer = null;
// Wakes the app when the next running timer goes 3 hours untouched (see scheduleStillThere).
let stillThereTimer = null;
// The unconfirmed stretch "Still locked in?" was last asked about, so closing it doesn't bring it straight back.
let stillThereAsked = null;

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
// Every time and date on screen is St Andrews time (TZ), wherever the phone is.
const timeOf = (iso) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const inviteLink = (code) => `${location.origin}${location.pathname}?join=${code}`;

function toast(text, { bad = false, ms = 3800 } = {}) {
  const node = h("div", { class: `toast${bad ? " bad" : ""}` }, text);
  const stack = document.getElementById("toasts");
  // Two at a time: a burst of actions mustn't bury the screen.
  while (stack.children.length >= 2) stack.firstChild.remove();
  stack.append(node);
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

/* Bottom sheets that behave like a phone's: while one is open the page behind
   stays put, and each has a history entry, so Back (or Safari's edge swipe)
   closes it instead of leaving the app. Open sheets, newest last. */
const sheets = [];
// Sheets use history entries, so stop the browser restoring a scroll position when one closes.
if ("scrollRestoration" in history) history.scrollRestoration = "manual";
// history.back() calls of our own still to arrive as popstate, so they don't close another sheet.
let ownBacks = 0;

addEventListener("popstate", () => {
  if (ownBacks) {
    ownBacks--;
    // A sheet opened while our own Back was in flight gets its entry now.
    if (!ownBacks) for (const s of sheets) if (!s.pushed) { history.pushState({ sheet: true }, ""); s.pushed = true; }
    return;
  }
  sheets.at(-1)?.close({ fromHistory: true });
});

const onSheetKey = (ev) => { if (ev.key === "Escape") sheets.at(-1)?.close(); };

/**
 * A bottom sheet. `build(box, close)` fills it. `key` makes a second tap on the
 * same thing a no-op instead of a second sheet. `focus` is the field that should
 * take the keyboard, if any; otherwise the sheet itself takes focus, so no
 * keyboard or date picker pops up uninvited.
 */
function sheet(build, { key = null, focus = null } = {}) {
  const already = key && sheets.find((s) => s.key === key);
  if (already) return already.close;
  const box = h("div", { class: "sheet", role: "dialog", "aria-modal": "true", tabindex: "-1" });
  // Like h(): a child left out by a condition (null or false) is skipped, not shown as "null".
  box.append = (...kids) => Element.prototype.append.apply(box, kids.flat(Infinity).filter((kid) => kid != null && kid !== false));
  const back = h("div", { class: "sheet-back", onclick: (ev) => { if (ev.target === back) close(); } }, box);
  const entry = { key, close, pushed: false };
  function close({ fromHistory = false } = {}) {
    const i = sheets.indexOf(entry);
    if (i < 0) return;
    sheets.splice(i, 1);
    back.remove();
    if (!sheets.length) { document.documentElement.classList.remove("sheet-open"); document.removeEventListener("keydown", onSheetKey); }
    if (!fromHistory && entry.pushed) { ownBacks++; history.back(); }
  }
  if (!sheets.length) { document.documentElement.classList.add("sheet-open"); document.addEventListener("keydown", onSheetKey); }
  sheets.push(entry);
  if (!ownBacks) { history.pushState({ sheet: true }, ""); entry.pushed = true; }
  build(box, close);
  document.body.append(back);
  (focus || box).focus({ preventScroll: true });
  return close;
}

// iOS leaves fixed elements under the on-screen keyboard; lift sheets above it.
if (window.visualViewport) {
  const lift = () => {
    const zoomed = Math.abs(visualViewport.scale - 1) > 0.01;
    const hidden = zoomed ? 0 : Math.max(0, Math.round(innerHeight - visualViewport.height - visualViewport.offsetTop));
    document.documentElement.style.setProperty("--keyboard", `${hidden}px`);
  };
  visualViewport.addEventListener("resize", lift);
  visualViewport.addEventListener("scroll", lift);
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
    h("p", { class: "small muted", style: { marginTop: "18px" } }, "No email or password. Your account lives on this device; add others from Me whenever you like."),
    h("button", { class: "link", style: { marginTop: "6px" }, onclick: () => enterCode() }, "I already use Locked In on another device")));
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
  // A watch link (#watch=…) is a read-only page for someone without an account. The secret stays in the
  // fragment, so it never reaches a server log or another site's Referer.
  const watching = new URLSearchParams(location.hash.slice(1)).get("watch");
  if (watching) return watchPage(watching);
  const params = new URLSearchParams(location.search);
  const join = params.get("join");
  if (join) try { sessionStorage.setItem(JOIN_KEY, join.toUpperCase()); } catch (_) {}
  if (params.has("link")) store(LINKING_KEY, "1");
  if (join || params.has("link")) history.replaceState({}, "", location.pathname);
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
  if (!state.modules.length && readStored(SKIPPED_MODULES_KEY) !== "1") return modulesStep();
  render();
  scrollTo({ top: 0 });
}

/** First run: your own modules. Nothing is assumed; skip and add them later if you like. */
function modulesStep() {
  const list = h("div", { class: "chips module-chips" });
  const input = h("input", { id: "m-name", class: "input", maxlength: 40, placeholder: "Module name or code", autocomplete: "off" });
  const paint = () => list.replaceChildren(...activeModules().map((m) => h("span", { class: "chip module-chip" }, dot(m), m.name)));
  const done = h("button", { class: "btn btn-big btn-block", type: "button", onclick: () => { render(); scrollTo({ top: 0 }); } }, "Let's go →");
  app().replaceChildren(h("main", { class: "welcome" },
    h("div", { class: "welcome-lock", "aria-hidden": "true" }, "📚"),
    h("h1", null, "What are you studying?"),
    h("p", null, "Add your modules — course names, codes, anything you want to time. Only you see this list, and you can change it any time."),
    h("div", { class: "step card" },
      h("form", { onsubmit: async (ev) => {
        ev.preventDefault();
        if (await addModule(input.value)) { input.value = ""; paint(); input.focus(); done.disabled = false; }
      } },
        h("label", { class: "label", for: "m-name" }, "Add a module"),
        h("div", { class: "row" }, input, h("button", { class: "btn", type: "submit" }, "Add"))),
      list,
      h("div", { style: { marginTop: "22px" } }, done)),
    h("button", { class: "link", style: { marginTop: "14px" }, onclick: () => { store(SKIPPED_MODULES_KEY, "1"); render(); scrollTo({ top: 0 }); } }, "Skip for now")));
  done.disabled = !activeModules().length;
  paint();
  input.focus();
}

async function loadCrews() {
  const { data, error } = await db.from("crews").select("id, name, code, created_by, crew_members(count)").order("created_at");
  if (error) return oops(error);
  state.crews = (data || []).map((c) => ({ ...c, members: c.crew_members?.[0]?.count || 1 }));
}

async function refresh() {
  const uid = state.user.id;
  const [stats, live, feed, mine, keys, modules, watchers] = await Promise.all([
    db.rpc("room_stats", { p_tz: TZ }),
    // Yours and your crewmates', as the database allows: who's studying, who's on a break.
    db.from("live").select("user_id, session_id, subject, started_at, location, paused_at, paused_subject, banked_seconds, now_playing, checked_at"),
    db.from("sessions").select("id, user_id, subject, started_at, ended_at, location").order("ended_at", { ascending: false }).limit(25),
    db.from("sessions").select("id, subject, started_at, ended_at, location").eq("user_id", uid).gte("started_at", new Date(Date.now() - 70 * 86400000).toISOString()).order("started_at", { ascending: false }).limit(400),
    db.from("link_keys").select("id, label, created_at, last_used_at").order("created_at"),
    db.rpc("my_subject_stats", { p_tz: TZ }),
    db.from("watch_links").select("id, label, created_at, last_seen_at").order("created_at"),
    loadCrews(),
  ]);
  if (MUSIC) db.rpc("my_music").then(({ data }) => { if (data) { const changed = JSON.stringify(data) !== JSON.stringify(state.music); state.music = data; if (changed && state.tab === "me") keepFocus(render); } });
  const failed = [stats, live, feed, mine, keys, modules, watchers].find((r) => r.error);
  if (failed) return oops(failed.error, "Couldn't load your crew.");
  state.people = stats.data || [];
  state.liveRows = new Map((live.data || []).map((row) => [row.user_id, row]));
  const own = state.liveRows.get(uid);
  state.live = own?.started_at ? own : null;
  state.paused = onBreak(own, BREAK_KEPT_MS) ? own : null;
  state.breaks = (live.data || []).filter((row) => row.user_id !== uid && byId(row.user_id) && onBreak(row, BREAK_SHOWN_MS));
  state.feed = feed.data || [];
  state.mine = mine.data || [];
  state.keys = keys.data || [];
  state.watchers = watchers.data || [];
  state.modules = modules.data || [];
  scheduleStillThere();
}

/** Refresh when the next running timer goes 3 hours untouched: a crewmate's drops off the list, yours asks if you're still there. */
function scheduleStillThere() {
  clearTimeout(stillThereTimer);
  const next = Math.min(...[...state.liveRows.values()].map(hiddenFrom).filter((at) => at > Date.now()));
  if (Number.isFinite(next)) stillThereTimer = setTimeout(refreshSoon, next - Date.now() + 1000);
}

/* ------------------------------------------------------------
   Modules — everyone's own list
   ------------------------------------------------------------ */

const activeModules = () => state.modules.filter((m) => !m.archived);
const dot = (m) => h("i", { class: "module-dot", style: { background: `var(--m${m?.color ?? 0})` }, "aria-hidden": "true" });
const moduleNamed = (name) => state.modules.find((m) => m.name.toLowerCase() === String(name).trim().toLowerCase());

async function reloadModules() {
  const { data, error } = await db.rpc("my_subject_stats", { p_tz: TZ });
  if (!error) state.modules = data || [];
}

/** Adds a module, or brings an archived one of the same name back. Returns it, or null. */
async function addModule(raw) {
  const name = String(raw || "").trim();
  if (!name) { toast("Give the module a name.", { bad: true }); return null; }
  const existing = moduleNamed(name);
  if (existing && !existing.archived) { toast(`You already have ${existing.name}.`); return existing; }
  const { error } = existing
    ? await db.from("subjects").update({ archived: false }).eq("id", existing.subject_id)
    : await db.from("subjects").insert({ user_id: state.user.id, name });
  if (error) { oops(error.code === "23505" ? { message: `You already have ${name}.` } : error); return null; }
  await reloadModules();
  return moduleNamed(name);
}

function addModuleSheet(onAdded) {
  const input = h("input", { id: "add-module", class: "input", maxlength: 40, placeholder: "Module name or code", autocomplete: "off" });
  sheet((box, close) => box.append(
    h("h2", null, "Add a module"),
    h("form", { style: { marginTop: "14px" }, onsubmit: async (ev) => {
      ev.preventDefault();
      const added = await addModule(input.value);
      if (!added) return;
      close();
      onAdded?.(added);
      render();
    } }, input, h("div", { class: "btn-row" }, h("button", { class: "btn btn-soft", type: "button", onclick: close }, "Cancel"), h("button", { class: "btn", type: "submit" }, "Add")))), { focus: input });
}

function renameModule(m) {
  const input = h("input", { class: "input", maxlength: 40, value: m.name });
  sheet((box, close) => box.append(
    h("h2", null, `Rename ${m.name}`),
    h("p", { class: "muted", style: { marginTop: "6px" } }, "Your past sessions are renamed too, so the hours stay together."),
    h("form", { style: { marginTop: "14px" }, onsubmit: async (ev) => {
      ev.preventDefault();
      const { error } = await db.rpc("rename_subject", { p_id: m.subject_id, p_name: input.value.trim() });
      if (error) return oops(error);
      if (state.subject.trim().toLowerCase() === m.name.toLowerCase()) state.subject = input.value.trim();
      close(); await refresh(); render(); toast("Renamed.");
    } }, input, h("div", { class: "btn-row" }, h("button", { class: "btn btn-soft", type: "button", onclick: close }, "Cancel"), h("button", { class: "btn", type: "submit" }, "Save")))), { focus: input });
}

async function archiveModule(m, archived) {
  // A module that never had any time can simply go; one with history keeps its name in an archive.
  if (archived && !m.total_minutes) {
    // Row-level security turns a refused delete into "nothing deleted", not an error.
    const { data, error } = await db.from("subjects").delete().eq("id", m.subject_id).select("id");
    if (!error && data?.length) { await reloadModules(); render(); toast(`${m.name} removed.`); return; }
  }
  const { error } = await db.from("subjects").update({ archived }).eq("id", m.subject_id);
  if (error) return oops(error);
  if (archived && state.subject.trim().toLowerCase() === m.name.toLowerCase()) state.subject = "";
  await reloadModules();
  render();
  toast(archived ? `${m.name} archived — its hours stay on your record.` : `${m.name} is back.`);
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
      // Coming back from a break, or saying "still here", isn't news; locking in is.
      if (row?.started_at && !row.banked_seconds && !row.checked_at && row.user_id !== state.user.id && before && !before.live_started_at) {
        notify(`${before.emoji} ${before.name} just locked in on ${row.subject}${row.location ? ` at ${row.location}` : ""}`);
      }
      refreshSoon();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "sessions" }, refreshSoon)
    // New crewmates and renamed ones. Inserts and updates only: those are RLS-checked, deletes aren't.
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "crew_members" }, refreshSoon)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles" }, refreshSoon)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "pings", filter: `to_user=eq.${state.user.id}` }, ({ new: ping }) => {
      const who = byId(ping.from_user);
      notify(ping.kind === "joining" ? `🏃 ${who?.name || "Someone"} is on the way to join you!` : `🔥 ${who?.name || "Someone"} is cheering you on!`);
    })
    .subscribe();
}

/* ------------------------------------------------------------
   Music — what people are playing while they're locked in.
   It comes through Last.fm: the music edge function checks the name
   you link and asks Last.fm every 30 seconds; this only shows it.
   ------------------------------------------------------------ */

/** Calls the music function; a refusal comes back as its own message, not "non-2xx status code". */
async function musicCall(action, extra = {}) {
  const { data, error } = await db.functions.invoke("music", { body: { action, ...extra } });
  if (!error) return { data };
  const body = await error.context?.json?.().catch(() => null);
  return { error: { message: body?.error || "Music can't be reached right now. Try again in a minute." } };
}

function linkMusicSheet() {
  const music = state.music || {};
  const input = h("input", { id: "lastfm-name", class: "input", maxlength: 60, placeholder: "Your Last.fm username", value: music.lastfm || "", autocomplete: "off", autocapitalize: "none", spellcheck: "false" });
  const outside = (href, text) => h("a", { class: "btn btn-small btn-soft", href, target: "_blank", rel: "noopener" }, text);
  sheet((box, close) => box.append(
    h("h2", null, "Show what you're playing 🎧"),
    h("p", { class: "muted", style: { marginTop: "6px" } }, "Locked In hears it through Last.fm, a free site Spotify reports to. It takes two minutes, once, and your crew only sees it while you're locked in."),
    h("div", { class: "setting", style: { marginTop: "8px" } },
      h("div", null, h("strong", null, "1. Get a free Last.fm account"), h("small", null, "Skip this if you have one")),
      outside("https://www.last.fm/join", "Sign up ↗")),
    h("div", { class: "setting" },
      h("div", null, h("strong", null, "2. Connect Spotify to it"), h("small", null, "Applications → Spotify Scrobbling → Connect")),
      outside("https://www.last.fm/settings/applications", "Open ↗")),
    h("form", { onsubmit: async (ev) => {
      ev.preventDefault();
      const go = ev.currentTarget.querySelector("button[type=submit]");
      go.disabled = true;
      const { data, error } = await musicCall("link", { name: input.value });
      go.disabled = false;
      if (error) return oops(error);
      state.music = { connected: true, lastfm: data.name, problem: null };
      close(); render();
      // No scrobbles at all usually means step 2 hasn't happened yet.
      if (data.scrobbles) toast(`Linked ${data.name} 🎧 Your crew sees what you play while you're locked in.`, { ms: 6000 });
      else toast(`Linked ${data.name}, but nothing has reached Last.fm yet. Connect Spotify to it (step 2), then play a song.`, { bad: true, ms: 8000 });
    } },
      h("label", { class: "field" }, h("span", { class: "label" }, "3. Your Last.fm username"), input),
      h("div", { class: "btn-row" }, h("button", { class: "btn btn-soft", type: "button", onclick: close }, "Cancel"), h("button", { class: "btn", type: "submit" }, "Link"))),
    music.connected ? h("button", { class: "link", style: { marginTop: "6px" }, onclick: () => { close(); unlinkMusic(); } }, "Stop showing my music") : null));
}

async function unlinkMusic() {
  if (!confirm("Stop showing your crew what you're listening to?")) return;
  const { error } = await musicCall("unlink");
  if (error) return oops(error);
  state.music = { connected: false, lastfm: null, problem: null };
  await refresh(); render();
  toast("Music unlinked.");
}

/** A stretch just started: ask Last.fm now rather than waiting for the next 30-second check. */
function askMusic() {
  if (MUSIC && state.music?.connected) musicCall("now");
}

/** "🎧 Song · Artist", finding it on Spotify. */
function playingLine(playing) {
  if (!playing?.title) return null;
  const kids = [
    playing.image ? h("img", { src: playing.image, alt: "", width: 36, height: 36, loading: "lazy", decoding: "async" }) : h("span", { class: "now-playing-icon", "aria-hidden": "true" }, "🎧"),
    h("span", { class: "now-playing-text" }, h("strong", null, playing.title), playing.by ? h("small", null, playing.by) : null),
    h("span", { class: "now-playing-source" }, "Spotify"),
  ];
  const label = `Listening to ${playing.title}${playing.by ? ` by ${playing.by}` : ""}`;
  return playing.url
    ? h("a", { class: "now-playing", href: playing.url, target: "_blank", rel: "noopener", "aria-label": `${label}, find it on Spotify` }, ...kids)
    : h("div", { class: "now-playing", "aria-label": label }, ...kids);
}

function musicSetting() {
  if (!MUSIC) return null;
  const music = state.music || {};
  const note = music.problem
    || (music.connected ? `Last.fm: ${music.lastfm}. Your crew sees what you play while you're locked in` : "Show your crew what you're listening to while you're locked in");
  return h("div", { class: "setting" },
    h("div", null, h("strong", null, "🎧 Music"), h("small", { class: music.problem ? "setting-problem" : null }, note)),
    music.connected && !music.problem
      ? h("button", { class: "btn btn-small btn-soft", onclick: unlinkMusic }, "Unlink")
      : h("button", { class: "btn btn-small", onclick: linkMusicSheet }, music.problem ? "Fix" : "Set up"));
}

/* ------------------------------------------------------------
   The timer
   ------------------------------------------------------------ */

async function lockIn() {
  const subject = state.subject.trim();
  if (!subject) return toast("Pick a module first, or add one.", { bad: true });
  // A new sitting: whatever break was left over ends here.
  const row = { user_id: state.user.id, session_id: crypto.randomUUID(), subject, started_at: new Date().toISOString(), location: state.place.trim() || null, paused_at: null, paused_subject: null, banked_seconds: 0 };
  const { error } = await db.from("live").upsert(row, { onConflict: "user_id" });
  if (error) return oops(error);
  state.live = row;
  render();
  scrollTo({ top: 0, behavior: "smooth" });
  refreshSoon();
  askMusic();
}

/** Saves the stretch running now, if it's long enough to count. Returns its length, or null if that failed. */
async function saveStretch(live, end) {
  const length = +end - +new Date(live.started_at);
  if (length < MIN_SESSION_MS) return 0;
  const { error } = await db.from("sessions").insert({ id: live.session_id, user_id: state.user.id, subject: live.subject, started_at: live.started_at, ended_at: end.toISOString(), location: live.location });
  if (error) { oops(error); return null; }
  return length;
}

/** The whole sitting is over: XP for all of it, and a level-up if it got you one. `subject` is null when it spanned more than one stretch. */
async function celebrate(subject, minutes, levelBefore) {
  await refresh();
  render();
  const after = levelProgress(byId(state.user.id)?.total_minutes || 0);
  if (minutes < 1) toast("Under a minute — not counted.");
  else if (after.level > levelBefore) { confetti(["⭐️", "🎉", "🏆", "✨"]); toast(`Level up! You're Level ${after.level} — ${after.title} 🏆`, { ms: 6000 }); }
  else { if (minutes >= 25) confetti(); toast(`+${Math.round(minutes)} XP · ${hm(minutes)} ${subject ? `on ${subject}` : "this session"} 💪`); }
}

/** Stops the timer. Under a minute isn't kept; past 16 hours we ask when you really stopped. */
async function finish({ discard = false, end = new Date() } = {}) {
  const live = state.live;
  if (!live) return;
  if (!discard && +end - +new Date(live.started_at) > MAX_SESSION_MS) return askWhenStopped();
  // Stretches before a break are saved already, so XP counts from the sitting's start.
  const banked = (live.banked_seconds || 0) / 60;
  const levelBefore = levelProgress((byId(state.user.id)?.total_minutes || 0) - banked).level;
  const saved = discard ? 0 : await saveStretch(live, end);
  if (saved === null) return;
  const { error } = await db.from("live").update({ session_id: null, subject: null, started_at: null, location: null, paused_at: null, paused_subject: null, banked_seconds: 0 }).eq("user_id", state.user.id);
  if (error) return oops(error);
  state.live = null;
  if (discard) {
    await refresh(); render();
    return toast(banked >= 1 ? `This stretch is cancelled. The ${hm(banked)} before your break stays saved.` : "Timer cancelled.");
  }
  // A sitting with breaks or switches may span modules, so it's "this session" then.
  await celebrate(banked ? null : live.subject, banked + saved / 60000, levelBefore);
}

/** Takes a break: the stretch so far is saved, and the sitting waits for Resume. */
async function pause() {
  const live = state.live;
  if (!live) return;
  const end = new Date();
  if (+end - +new Date(live.started_at) > MAX_SESSION_MS) return askWhenStopped();
  const saved = await saveStretch(live, end);
  if (saved === null) return;
  const row = { session_id: null, subject: null, started_at: null, paused_at: end.toISOString(), paused_subject: live.subject, banked_seconds: (live.banked_seconds || 0) + Math.round(saved / 1000) };
  const { error } = await db.from("live").update(row).eq("user_id", state.user.id);
  if (error) return oops(error);
  state.live = null;
  state.paused = { ...live, ...row };
  render();
  refreshSoon();
  toast(row.banked_seconds >= 60 ? `Paused · ${hm(row.banked_seconds / 60)} saved so far ☕` : "Paused ☕");
}

/**
 * Switch module without stopping. The time so far is saved under the module
 * you were on, and a new stretch starts on the new one in the same sitting,
 * so the clock and the XP carry on.
 */
async function switchModule(name) {
  const live = state.live;
  if (!live || name === live.subject) return;
  const now = new Date();
  const length = +now - +new Date(live.started_at);
  if (length > MAX_SESSION_MS) return askWhenStopped();
  const fresh = length < MIN_SESSION_MS;
  // Under a minute in, it was the wrong button: relabel the stretch instead of saving a scrap.
  const saved = fresh ? 0 : await saveStretch(live, now);
  if (saved === null) return;
  const row = fresh
    ? { subject: name }
    : { session_id: crypto.randomUUID(), subject: name, started_at: now.toISOString(), banked_seconds: (live.banked_seconds || 0) + Math.round(saved / 1000) };
  // Only this timer: if it was stopped or replaced on another device, nothing changes.
  const { data, error } = await db.from("live").update(row).eq("user_id", state.user.id).eq("session_id", live.session_id).select("session_id");
  if (error) return oops(error);
  if (!data?.length) { await refresh(); render(); return toast("That timer isn't running any more.", { bad: true }); }
  state.live = { ...live, ...row };
  state.subject = name;
  render();
  refreshSoon();
  toast(fresh ? `Switched to ${name}` : `Switched to ${name} · ${hm(saved / 60000)} on ${live.subject} saved`);
}

/** Back from the break: a new stretch of the same sitting, in the same place, on whichever module you pick. */
async function resume(subject = state.paused?.paused_subject) {
  const paused = state.paused;
  if (!paused) return;
  const row = { session_id: crypto.randomUUID(), subject, started_at: new Date().toISOString(), location: paused.location, paused_at: null, paused_subject: null, banked_seconds: paused.banked_seconds };
  const { error } = await db.from("live").update(row).eq("user_id", state.user.id);
  if (error) return oops(error);
  state.paused = null;
  state.live = { ...paused, ...row };
  render();
  refreshSoon();
  askMusic();
}

/** Done from a break: nothing left to save, so just close the sitting. */
async function endBreak() {
  const paused = state.paused;
  if (!paused) return;
  const minutes = (paused.banked_seconds || 0) / 60;
  const levelBefore = levelProgress((byId(state.user.id)?.total_minutes || 0) - minutes).level;
  const { error } = await db.from("live").update({ location: null, paused_at: null, paused_subject: null, banked_seconds: 0 }).eq("user_id", state.user.id);
  if (error) return oops(error);
  state.paused = null;
  await celebrate(null, minutes, levelBefore);
}

function askWhenStopped() {
  const start = new Date(state.live.started_at);
  const day = h("input", { class: "input", type: "date", value: ukDay(start), max: ukDay(new Date()) });
  const time = h("input", { class: "input", type: "time", value: timeOf(new Date(+start + 2 * 3600000)) });
  sheet((box, close) => box.append(
    h("h2", null, "That's a long one 😅"),
    h("p", { class: "muted", style: { marginTop: "6px" } }, `You've been locked in since ${start.toLocaleString("en-GB", { timeZone: TZ, weekday: "short", hour: "2-digit", minute: "2-digit" })}. When did you actually stop?`),
    h("div", { class: "row", style: { marginTop: "16px" } }, day, time),
    h("div", { class: "btn-row" },
      h("button", { class: "btn btn-soft", onclick: () => { close(); finish({ discard: true }); } }, "Throw it away"),
      h("button", { class: "btn", onclick: () => { close(); finish({ end: ukAt(day.value, time.value) }); } }, "Save"))), { key: "when-stopped" });
}

/* ------------------------------------------------------------
   "Still locked in?" — after 3 hours untouched, a timer waits for its
   owner to say so. Until then the crew doesn't see it and the board
   stops counting at the 3-hour mark (the database does both); the
   timer itself keeps running.
   ------------------------------------------------------------ */

/** Asks once per untouched stretch, when nothing else is open. Past 16 hours it can only be "when did you stop?". */
function askIfStillThere() {
  const live = state.live;
  if (!live || !unconfirmed(live) || sheets.length) return;
  const asking = `${live.session_id}@${hiddenFrom(live)}`;
  if (stillThereAsked === asking) return;
  stillThereAsked = asking;
  if (Date.now() - +new Date(live.started_at) > MAX_SESSION_MS) return askWhenStopped();
  const since = Math.max(+new Date(live.started_at), live.checked_at ? +new Date(live.checked_at) : 0);
  const sinceText = `${new Date(since).toLocaleString("en-GB", { timeZone: TZ, weekday: ukDay(new Date(since)) === ukDay(new Date()) ? undefined : "long", hour: "2-digit", minute: "2-digit" })}`;
  sheet((box, close) => box.append(
    h("h2", null, "Still locked in? 👀"),
    h("p", { class: "muted", style: { marginTop: "6px" } }, `Your ${live.subject} timer hasn't been touched since ${sinceText}. It's still running, but at ${timeOf(hiddenFrom(live))} your crew stopped seeing you and the board stopped counting. Say you're still here and it all counts again.`),
    h("div", { class: "btn-row" },
      h("button", { class: "btn btn-soft", onclick: () => { close(); editTimerSheet(); } }, "I stopped earlier"),
      h("button", { class: "btn", onclick: () => { close(); stillHere(); } }, "Yes, still going"))), { key: "still-there" });
}

/** "Yes, still going": seen and counted again, and asked again in 3 hours. */
async function stillHere() {
  const live = state.live;
  if (!live) return;
  // Only this timer: if it was stopped or replaced on another device, nothing changes.
  const { data, error } = await db.from("live").update({ checked_at: new Date().toISOString() }).eq("user_id", state.user.id).eq("session_id", live.session_id).select("checked_at");
  if (error) return oops(error);
  if (!data?.length) { await refresh(); render(); return toast("That timer isn't running any more.", { bad: true }); }
  state.live = { ...live, checked_at: data[0].checked_at };
  render(); refreshSoon();
  toast("Your crew can see you again 🔒");
}

/* ------------------------------------------------------------
   Painting
   ------------------------------------------------------------ */

/** Paint again whatever is showing: the app, or a watch link's page. */
const repaint = () => (state.watching ? paintWatch(state.watching) : render());

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
  askIfStillThere();
}

function nowView() {
  const others = state.people.filter((p) => p.live_started_at && p.user_id !== state.user.id)
    .sort((a, b) => +new Date(a.live_started_at) - +new Date(b.live_started_at));
  const me = byId(state.user.id);
  const crewToday = state.people.reduce((sum, p) => sum + p.today_minutes, 0);
  return [
    state.live ? runningCard() : state.paused ? pausedCard() : startCard(),
    h("section", { class: "section" },
      h("div", { class: "section-head" }, h("h2", null, "Locked in right now"), h("small", null, [others.length ? `${others.length} studying` : "", state.breaks.length ? `${state.breaks.length} on a break` : ""].filter(Boolean).join(" · "))),
      others.length || state.breaks.length
        ? [...others.map(liveCard), ...state.breaks.map(breakCard)]
        : h("div", { class: "card empty" }, h("span", { class: "big" }, "🦗"), state.live ? "Just you. Lead by example." : "Nobody's locked in. Be the first.")),
    h("section", { class: "section today" },
      h("div", { class: "stat" }, h("span", null, "You today"), h("strong", null, hm(me?.today_minutes || 0))),
      h("div", { class: "stat" }, h("span", null, "Crew today"), h("strong", null, hm(crewToday)))),
  ];
}

function startCard() {
  const modules = activeModules();
  // Default to whatever you studied last, if it's still one of your modules.
  if (!modules.some((m) => m.name === state.subject)) {
    const last = state.mine.find((s) => modules.some((m) => m.name.toLowerCase() === s.subject.toLowerCase()));
    state.subject = last ? moduleNamed(last.subject).name : modules[0]?.name || "";
  }
  const places = [...new Set(state.mine.map((s) => s.location).filter(Boolean))].slice(0, 6);
  const chips = h("div", { class: "chips module-chips", role: "group", "aria-label": "Your modules" });
  const go = h("button", { class: "btn btn-big btn-live btn-block", type: "submit", style: { marginTop: "20px" }, disabled: !modules.length });
  function paintChips() {
    go.textContent = state.subject ? `🔒 Lock in on ${state.subject}` : "🔒 Lock in";
    chips.replaceChildren(
      ...modules.map((m) => h("button", { type: "button", class: "chip module-chip", "aria-pressed": String(m.name === state.subject), onclick: () => { state.subject = m.name; paintChips(); } }, dot(m), m.name)),
      h("button", { type: "button", class: "chip chip-add", onclick: () => addModuleSheet((added) => { state.subject = added.name; }) }, "+ Add"));
  }
  paintChips();
  const place = h("input", { id: "place", class: "input", maxlength: 80, placeholder: "Main Library, café, home…", list: "places", value: state.place, oninput: (ev) => { state.place = ev.target.value; } });
  return h("form", { class: "card timer-card", onsubmit: (ev) => { ev.preventDefault(); lockIn(); } },
    h("h2", null, "What are you locking in on?"),
    modules.length ? chips : h("div", { class: "empty-modules" },
      h("p", { class: "muted" }, "Add the modules you study, then pick one to lock in on."),
      h("button", { type: "button", class: "btn btn-soft", onclick: () => addModuleSheet((added) => { state.subject = added.name; }) }, "+ Add a module")),
    state.me.share_location
      ? h("label", { class: "field" }, h("span", { class: "label" }, "Where (your crew sees this)"), place, h("datalist", { id: "places" }, places.map((p) => h("option", { value: p }))))
      : h("p", { class: "small muted", style: { marginTop: "12px" } }, "Location sharing is off — turn it on in Me if you want friends to find you."),
    go);
}

/** The sitting's clock: what's banked from before any break, ticking on from the stretch's start. */
const sittingClock = (row, className) => h("div", { class: className, dataset: { since: row.started_at, banked: row.banked_seconds || 0 } }, clock(sittingMs(row)));

function runningCard() {
  const live = state.live;
  const waiting = unconfirmed(live);
  return h("section", { class: `card running${waiting ? " is-unconfirmed" : ""}` },
    h("span", { class: "running-tag" }, waiting ? "STILL LOCKED IN?" : "LOCKED IN"),
    h("h2", null, live.subject),
    sittingClock(live, "big-clock"),
    h("div", { class: "xp-tick" }, "⭐️ +", h("span", { dataset: { xpSince: live.started_at, banked: live.banked_seconds || 0 } }, String(Math.floor(sittingMs(live) / 60000))), " XP"),
    waiting ? h("div", { class: "still-there" },
      h("p", null, `🙈 Your crew stopped seeing you at ${timeOf(hiddenFrom(live))}, 3 hours after you last touched this timer.`),
      h("div", { class: "btn-row" },
        h("button", { class: "btn btn-soft", onclick: () => editTimerSheet() }, "I stopped earlier"),
        h("button", { class: "btn", onclick: () => stillHere() }, "Yes, still going"))) : null,
    live.location ? h("p", { class: "running-where" }, "📍 ", live.location) : null,
    playingLine(live.now_playing),
    switchChips(live.subject),
    h("div", { class: "running-actions" },
      h("button", { class: "btn btn-big btn-soft", onclick: () => pause() }, "⏸ Pause"),
      h("button", { class: "btn btn-big", onclick: () => finish() }, "✓ Done")),
    h("div", { class: "running-foot" },
      h("button", { class: "link", onclick: () => editTimerSheet() }, "Edit"), " · ",
      h("button", { class: "link", onclick: () => finish({ discard: true }) }, live.banked_seconds ? "Cancel this stretch" : "Cancel without saving")));
}

/** The other modules, one tap each: the clock keeps going and the time so far stays with the module it was on. */
function switchChips(current) {
  const others = activeModules().filter((m) => m.name !== current);
  if (!others.length) return null;
  return h("div", { class: "switch-to" },
    h("span", { class: "label" }, "Switch module · same session"),
    h("div", { class: "chips module-chips" }, others.map((m) => h("button", { type: "button", class: "chip module-chip", onclick: () => switchModule(m.name) }, dot(m), m.name))));
}

function pausedCard() {
  const paused = state.paused;
  let next = paused.paused_subject;
  const go = h("button", { class: "btn btn-big btn-live", onclick: () => resume(next) });
  const names = [...new Set([paused.paused_subject, ...activeModules().map((m) => m.name)])];
  const chips = h("div", { class: "chips module-chips", role: "group", "aria-label": "Resume on" });
  function paint() {
    go.textContent = next === paused.paused_subject ? "▶ Resume" : `▶ Resume on ${next}`;
    chips.replaceChildren(...names.map((name) => h("button", { type: "button", class: "chip module-chip", "aria-pressed": String(name === next), onclick: () => { next = name; paint(); } }, dot(moduleNamed(name)), name)));
  }
  paint();
  return h("section", { class: "card running is-paused" },
    h("span", { class: "running-tag" }, "ON A BREAK"),
    h("h2", null, paused.paused_subject),
    h("div", { class: "big-clock" }, clock(sittingMs(paused))),
    h("p", { class: "break-for" }, "☕ Break ", h("span", { dataset: { since: paused.paused_at } }, clock(Date.now() - +new Date(paused.paused_at)))),
    paused.location ? h("p", { class: "running-where" }, "📍 ", paused.location) : null,
    names.length > 1 ? h("div", { class: "switch-to" }, h("span", { class: "label" }, "Resume on"), chips) : null,
    h("div", { class: "running-actions" },
      go,
      h("button", { class: "btn btn-big btn-soft", onclick: () => endBreak() }, "✓ Done")),
    h("p", { class: "small muted running-foot" }, "Your crew sees you're on a break. The time so far is saved."));
}

function liveCard(p) {
  const ping = async (kind) => {
    const { error } = await db.from("pings").insert({ to_user: p.user_id, kind });
    if (error) return oops(error);
    toast(kind === "joining" ? `Told ${p.name} you're coming 🏃` : `Sent ${p.name} some fire 🔥`);
  };
  return h("article", { class: "card live-card" },
    personButton(p, "live-person",
      h("span", { class: "avatar is-live", "aria-hidden": "true" }, p.emoji),
      h("div", { class: "live-who" },
        h("strong", null, p.name), " ", sittingClock({ started_at: p.live_started_at, banked_seconds: state.liveRows.get(p.user_id)?.banked_seconds }, "live-clock"),
        h("p", null, p.live_subject, p.live_location ? ` · 📍 ${p.live_location}` : ""))),
    playingLine(state.liveRows.get(p.user_id)?.now_playing),
    state.watching ? null : h("div", { class: "live-actions" },
      p.live_location ? h("button", { class: "btn btn-small btn-live", onclick: () => ping("joining") }, "🏃 I'm coming") : null,
      h("button", { class: "btn btn-small btn-soft", onclick: () => ping("cheer") }, "🔥 Hype")));
}

function breakCard(row) {
  const p = byId(row.user_id);
  return h("article", { class: "card live-card break-card" },
    personButton(p, "live-person",
      h("span", { class: "avatar", "aria-hidden": "true" }, p.emoji),
      h("div", { class: "live-who" },
        h("strong", null, p.name), " ", h("span", { class: "break-clock" }, "☕ ", h("span", { dataset: { since: row.paused_at } }, clock(Date.now() - +new Date(row.paused_at)))),
        h("p", null, `On a break from ${row.paused_subject} · ${hm(row.banked_seconds / 60)} so far`))));
}

const BOARDS = { today: { label: "Today", key: "today_minutes", period: "day", total: "today" }, week: { label: "This week", key: "week_minutes", period: "week", total: "this week" }, all: { label: "All time", key: "total_minutes" } };

function boardView() {
  const board = BOARDS[state.board] || BOARDS.week;
  const key = board.key;
  const ranked = standings(state.people, key);
  const crewTotal = ranked.reduce((sum, p) => sum + p[key], 0);
  // An empty day is an open race, not a tie between everybody.
  const who = state.watching && byId(state.user.id)?.name;
  const chase = crewTotal ? chaseLine(ranked, state.user.id, key, who) : board.period === "day" ? `Nobody's on the board today yet.${who ? "" : " Lock in to take first."}` : null;
  const leader = Math.max(1, ...ranked.map((p) => p[key]));
  const spot = (p, place) => p
    ? personButton(p, `podium-spot ${place}`, h("span", { class: `avatar${p.live_started_at ? " is-live" : ""}` }, p.emoji), h("span", { class: "podium-name" }, p.name), h("span", { class: "podium-time" }, hm(p[key])),
      h("div", { class: "podium-block" }, place === "first" ? "1" : place === "second" ? "2" : "3"))
    : h("div", { class: `podium-spot ${place} empty-spot` }, h("span", { class: "avatar" }, "?"), h("span", { class: "podium-name" }, "—"), h("div", { class: "podium-block" }));
  return [
    h("section", { class: "card" },
      h("div", { class: "board-head" },
        h("div", { class: "toggle", role: "group", "aria-label": "Period" },
          ...Object.entries(BOARDS).map(([k, b]) => h("button", { "aria-pressed": String(board === b), onclick: () => { state.board = k; store(BOARD_KEY, k); repaint(); } }, b.label))),
        h("span", { class: "reset" }, board.period ? `Resets in ${untilReset(new Date(), board.period)}` : `${hm(crewTotal)} together`)),
      h("div", { class: "podium" }, spot(ranked[1], "second"), spot(ranked[0], "first"), spot(ranked[2], "third")),
      chase ? h("div", { class: "chase" }, h("span", { "aria-hidden": "true" }, "🎯"), h("span", null, chase)) : null,
      h("ol", { class: "ranks" }, ranked.map((p) => h("li", null, personButton(p, `rank-row${p.user_id === state.user.id ? " is-me" : ""}`,
        h("span", { class: "rank-num" }, String(p.rank)),
        h("span", { class: `avatar${p.live_started_at ? " is-live" : ""}`, "aria-hidden": "true" }, p.emoji),
        h("div", { class: "rank-main" },
          h("strong", null, h("span", null, p.name), p.live_started_at ? h("i", { class: "live-dot", title: "Locked in now" }) : null, p.streak ? h("em", { class: "flame" }, `🔥${p.streak}`) : null),
          h("div", { class: "rank-bar" }, h("span", { style: { width: `${Math.max(3, (p[key] / leader) * 100)}%` } }))),
        h("span", { class: "rank-time" }, hm(p[key]))))))),
    board.total ? h("p", { class: "small muted", style: { textAlign: "center", margin: "12px 0 0" } }, `Crew total ${board.total}: ${hm(crewTotal)}`) : null,
    h("section", { class: "section" },
      h("div", { class: "section-head" }, h("h2", null, "Recent sessions")),
      h("div", { class: "card" }, state.feed.length ? state.feed.map((s) => {
        const p = byId(s.user_id);
        return (p ? (...kids) => personButton(p, "feed-row", ...kids) : (...kids) => h("div", { class: "feed-row" }, ...kids))(h("span", { class: "avatar", "aria-hidden": "true" }, p?.emoji || "📚"),
          h("div", null, h("p", null, `${p?.name || "Someone"} · ${s.subject}`), h("small", null, [s.location ? `📍 ${s.location}` : null, ago(s.ended_at)].filter(Boolean).join(" · "))),
          h("span", { class: "feed-time" }, hm(minutesBetween(s.started_at, s.ended_at))));
      }) : h("p", { class: "empty" }, "Finished sessions show up here."))),
  ];
}

const EMPTY_STATS = { total_minutes: 0, week_minutes: 0, today_minutes: 0, longest_minutes: 0, session_count: 0, early_sessions: 0, late_sessions: 0, days: {} };

function meView() {
  const me = { ...EMPTY_STATS, ...byId(state.user.id), name: state.me.name, emoji: state.me.emoji, user_id: state.user.id };
  return [
    heroCard(me),
    activityCard(me, state.mine, "Your activity"),
    modulesCard(),
    badgesSection(me),
    h("section", { class: "section" },
      h("div", { class: "section-head" }, h("h2", null, "Your sessions"), h("button", { class: "btn btn-small btn-soft", onclick: () => sessionSheet() }, "+ Log one")),
      h("div", { class: "card" }, state.mine.length ? state.mine.slice(0, 20).map((s) => h("div", { class: "session-row" },
        h("div", null, h("p", null, s.subject), h("small", null, [`${new Date(s.started_at).toLocaleDateString("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" })} ${timeOf(s.started_at)}–${timeOf(s.ended_at)}`, s.location].filter(Boolean).join(" · "))),
        h("strong", { class: "feed-time" }, hm(minutesBetween(s.started_at, s.ended_at))),
        h("button", { class: "x", "aria-label": `Edit ${s.subject} session`, title: "Edit", onclick: () => sessionSheet(s) }, "✎"),
        h("button", { class: "x", "aria-label": `Delete ${s.subject} session`, title: "Delete", onclick: () => removeSession(s) }, "✕"))) : h("p", { class: "empty" }, "Your sessions show up here."))),
    settingsCard(),
  ];
}

/** Your modules: this week and all time, each with its own colour; rename, archive, add. */
function modulesCard() {
  const active = activeModules();
  const archived = state.modules.filter((m) => m.archived);
  const most = Math.max(1, ...active.map((m) => m.total_minutes));
  return h("section", { class: "section" },
    h("div", { class: "section-head" }, h("h2", null, "Your modules"), h("button", { class: "btn btn-small btn-soft", onclick: () => addModuleSheet() }, "+ Add")),
    h("div", { class: "card" },
      active.length ? active.map((m) => h("div", { class: "module-row" },
        h("div", { class: "module-main" },
          h("strong", null, dot(m), h("span", null, m.name)),
          h("small", null, `${hm(m.week_minutes)} this week · ${hm(m.total_minutes)} all time`),
          h("div", { class: "rank-bar" }, h("span", { style: { width: `${Math.max(3, (m.total_minutes / most) * 100)}%`, background: `var(--m${m.color})` } }))),
        h("div", { class: "module-actions" },
          h("button", { class: "link", "aria-label": `Rename ${m.name}`, onclick: () => renameModule(m) }, "Rename"),
          h("button", { class: "link", "aria-label": `${m.total_minutes ? "Archive" : "Remove"} ${m.name}`, onclick: () => archiveModule(m, true) }, m.total_minutes ? "Archive" : "Remove"))))
        : h("p", { class: "empty" }, "No modules yet. Add the ones you study — only you see them."),
      archived.length ? h("p", { class: "small muted", style: { marginTop: "12px" } }, "Archived: ", archived.map((m, i) => [i ? ", " : "", h("button", { class: "link", style: { padding: "0" }, title: `Bring ${m.name} back`, onclick: () => archiveModule(m, false) }, m.name)])) : null));
}

/* ------------------------------------------------------------
   Profiles: yours in Me, a crewmate's in a sheet
   ------------------------------------------------------------ */

function heroCard(person) {
  const streak = streakFrom(person.days);
  const level = levelProgress(person.total_minutes);
  const rank = standings(state.people, "week_minutes").find((p) => p.user_id === person.user_id)?.rank;
  return h("section", { class: "card hero" },
    h("span", { class: `avatar avatar-big${person.live_started_at ? " is-live" : ""}` }, person.emoji),
    h("h2", null, person.name),
    h("p", { class: "hero-title" }, `Level ${level.level} · ${level.title}`),
    person.live_started_at ? h("p", { class: "hero-live" }, "🔒 Locked in on ", h("b", null, person.live_subject), person.live_location ? ` at ${person.live_location}` : "") : null,
    h("div", { class: "xp" },
      h("div", { class: "xp-top" }, h("span", null, `${Math.round(person.total_minutes)} XP`), h("span", null, `${hm(level.toNext)} to Level ${level.level + 1}`)),
      h("div", { class: "xp-bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(Math.round(level.ratio * 100)) }, h("span", { style: { width: `${Math.max(2, level.ratio * 100)}%` } }))),
    h("div", { class: "hero-stats" },
      h("div", null, h("strong", null, hm(person.week_minutes)), h("span", null, rank && state.people.length > 1 ? `This week · #${rank}` : "This week")),
      h("div", null, h("strong", null, `🔥 ${streak}`), h("span", null, "Day streak")),
      h("div", null, h("strong", null, hm(person.total_minutes)), h("span", null, "All time"))));
}

function badgesSection(person) {
  const badges = badgesFor(person, streakFrom(person.days));
  return h("section", { class: "section" },
    h("div", { class: "section-head" }, h("h2", null, "Badges"), h("small", null, `${badges.filter((b) => b.got).length}/${badges.length}`)),
    h("div", { class: "badges" }, badges.map((b) => h("div", { class: `badge ${b.got ? "got" : "locked"}`, title: b.detail }, h("b", { "aria-hidden": "true" }, b.icon), h("strong", null, b.name), h("small", null, b.detail)))));
}

/** Weekly bars or the daily grid — one at a time, so a profile stays light. The choice sticks. */
function activityCard(person, sessions, title) {
  let view = readStored(ACTIVITY_KEY) === "daily" ? "daily" : "weekly";
  const body = h("div");
  const toggle = h("div", { class: "toggle toggle-small", role: "group", "aria-label": "Activity view" });
  function paint() {
    toggle.replaceChildren(...[["weekly", "Weekly"], ["daily", "Daily"]].map(([key, label]) => h("button", { type: "button", "aria-pressed": String(view === key), onclick: () => { view = key; store(ACTIVITY_KEY, key); paint(); } }, label)));
    body.replaceChildren(...(view === "daily" ? heatmap(person.days, sessions) : weeklyChart(person.days, sessions)));
  }
  paint();
  return h("section", { class: "section" },
    h("div", { class: "section-head" }, h("h2", null, title), toggle),
    h("div", { class: "card" }, body));
}

const dayLabel = (date) => date.toLocaleDateString("en-GB", { timeZone: TZ, weekday: "long", day: "numeric", month: "short" });
const shortDate = (date) => date.toLocaleDateString("en-GB", { timeZone: TZ, day: "numeric", month: "short" });
const subjectLines = (list) => list.slice(0, 3).map((s) => `${s.subject} · ${hm(s.minutes)}`).concat(list.length > 3 ? [`+ ${list.length - 3} more`] : []);

/** Hours per week for the last ten weeks. This week, so far, is the bright bar. */
function weeklyChart(days = {}, sessions = []) {
  const weeks = weeksFrom(days, new Date(), 10);
  const best = Math.max(0, ...weeks.map((w) => w.minutes));
  if (!best) return [h("p", { class: "empty" }, "No study in the last ten weeks yet.")];
  const { top, step } = hourTicks(best);
  const pct = (minutes) => `${(minutes / top) * 100}%`;
  const grid = [];
  for (let v = step; v <= top; v += step) grid.push(h("span", { class: "wk-grid", style: { bottom: pct(v) } }, h("em", null, `${v / 60}h`)));
  const cols = weeks.map((w, i) => {
    const end = dayStart(w.start, 7);
    const before = weeks[i - 1]?.minutes;
    const labelled = w.minutes && (w.current || w.minutes === best);
    const col = h("button", { type: "button", class: `wk-col${w.current ? " is-current" : ""}`, "aria-label": `Week of ${shortDate(w.start)}: ${hm(w.minutes)}` },
      h("span", { class: "wk-bar", style: { height: w.minutes ? `max(3px, ${pct(w.minutes)})` : "0" } }),
      labelled ? h("b", { class: "wk-value", style: { bottom: `calc(${pct(w.minutes)} + 4px)` } }, shortHours(w.minutes)) : null);
    explain(col, () => [
      w.current ? `This week, so far` : `Week of ${shortDate(w.start)}`,
      w.minutes ? `${hm(w.minutes)}${before != null && !w.current ? ` · ${w.minutes >= before ? "+" : "−"}${hm(Math.abs(w.minutes - before))} on the week before` : ""}` : "No study",
      ...subjectLines(subjectsBetween(sessions, w.start, end)),
    ]);
    return col;
  });
  return [
    h("div", { class: "wk-chart" }, h("div", { class: "wk-plot" }, grid, cols)),
    h("div", { class: "wk-labels", "aria-hidden": "true" }, weeks.map((w, i) => h("span", null, w.current ? "Now" : i % 3 === 0 ? shortDate(w.start) : ""))),
    h("p", { class: "chart-note" }, "Hours per week, Monday to Sunday. Tap a bar for the details."),
  ];
}

/** Every day of the last ten weeks; darker is more. Tap or hover for the day. */
function heatmap(days = {}, sessions = []) {
  const today = new Date();
  const start = dayStart(weekStart(today), -63);
  const cells = [];
  for (let i = 0; i < 70; i++) {
    const day = dayStart(start, i);
    const minutes = days[ukDay(day)] || 0;
    if (day > today) { cells.push(h("span", { class: "heat-future", "aria-hidden": "true" })); continue; }
    const level = minutes >= 240 ? 4 : minutes >= 120 ? 3 : minutes >= 30 ? 2 : minutes > 0 ? 1 : 0;
    const cell = h("button", { type: "button", class: ukDay(day) === ukDay(today) ? "is-today" : null, dataset: { level }, "aria-label": `${dayLabel(day)}: ${minutes ? hm(minutes) : "no study"}` });
    const next = dayStart(day, 1);
    explain(cell, () => [dayLabel(day) + (ukDay(day) === ukDay(today) ? " (today)" : ""), minutes ? hm(minutes) : "No study", ...subjectLines(subjectsBetween(sessions, day, next))]);
    cells.push(cell);
  }
  return [h("div", { class: "heat", role: "group", "aria-label": "Study per day over the last ten weeks" }, cells),
    h("div", { class: "heat-legend" }, h("span", null, "Mon → Sun, oldest week left"), h("span", { class: "heat-key" }, "less", [0, 1, 2, 3, 4].map((l) => h("i", { dataset: { level: l } })), "more"))];
}

/* Details on hover (mouse), tap (touch) or focus (keyboard): one tooltip for the page. */
const tip = h("div", { class: "tip", role: "tooltip", hidden: true });
document.body.append(tip);
let tipFor = null;
let tipShownAt = 0;
function showTip(target, lines) {
  tipFor = target;
  tipShownAt = Date.now();
  tip.replaceChildren(...lines.map((line, i) => h(i ? "span" : "strong", null, line)));
  tip.hidden = false;
  const r = target.getBoundingClientRect();
  const left = Math.min(Math.max(8, r.left + r.width / 2 - tip.offsetWidth / 2), innerWidth - tip.offsetWidth - 8);
  const above = r.top - tip.offsetHeight - 10;
  tip.style.left = `${left}px`;
  tip.style.top = `${above > 8 ? above : r.bottom + 10}px`;
}
function hideTip() { tip.hidden = true; tipFor = null; }
function explain(node, lines) {
  node.addEventListener("pointerenter", (ev) => { if (ev.pointerType === "mouse") showTip(node, lines()); });
  node.addEventListener("pointerleave", (ev) => { if (ev.pointerType === "mouse") hideTip(); });
  node.addEventListener("focus", () => showTip(node, lines()));
  node.addEventListener("blur", hideTip);
  // A second tap closes it. On Android the tap's own focus opens it just before the click, which isn't a second tap.
  node.addEventListener("click", (ev) => { ev.stopPropagation(); if (tipFor === node && ev.pointerType !== "mouse" && Date.now() - tipShownAt > 400) hideTip(); else showTip(node, lines()); });
}
document.addEventListener("click", hideTip);
document.addEventListener("scroll", hideTip, { capture: true, passive: true });
addEventListener("resize", hideTip);

/** A crewmate's profile. Yours lives in Me. */
function openProfile(userId) {
  hideTip();
  if (userId === state.user.id) { state.tab = "me"; store(TAB_KEY, "me"); render(); scrollTo({ top: 0 }); return; }
  const stats = byId(userId);
  if (!stats) return;
  const person = { ...EMPTY_STATS, ...stats };
  // Open at once with what the board already knows; the sessions fill in when they arrive.
  sheet((box, close) => {
    const pending = h("div", { class: "card empty profile-pending" }, h("span", { class: "big" }, "⏳"), "Loading activity…");
    const badges = badgesSection(person);
    box.append(h("div", { class: "sheet-top" }, h("button", { class: "link", onclick: close }, "Close")), heroCard(person), pending, badges);
    db.from("sessions").select("subject, started_at, ended_at, location")
      .eq("user_id", userId).gte("started_at", new Date(Date.now() - 70 * 86400000).toISOString()).order("started_at", { ascending: false }).limit(400)
      .then(({ data: sessions, error }) => {
        if (!box.isConnected) return;
        if (error) return pending.replaceChildren("Couldn't load their activity. Close and try again.");
        pending.replaceWith(activityCard(person, sessions || [], "Activity"));
        badges.after(recentSessions(sessions || [], person.name));
      });
  }, { key: `profile:${userId}` });
}

/** Someone's last few sessions: module, when, how long, and where if they share it. */
const recentSessions = (sessions, name, count = 6) => h("section", { class: "section" },
  h("div", { class: "section-head" }, h("h2", null, "Recent sessions")),
  h("div", { class: "card" }, sessions.length ? sessions.slice(0, count).map((s) => h("div", { class: "session-row" },
    h("div", null, h("p", null, s.subject), h("small", null, [`${new Date(s.started_at).toLocaleDateString("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" })} ${timeOf(s.started_at)}–${timeOf(s.ended_at)}`, s.location].filter(Boolean).join(" · "))),
    h("strong", { class: "feed-time" }, hm(minutesBetween(s.started_at, s.ended_at))))) : h("p", { class: "empty" }, `${name} hasn't logged anything recently.`)));

/** Anywhere a person appears, tapping them opens their profile. Not on a watch page, which has no account to load them with. */
const personButton = (p, className, ...kids) => state.watching ? h("div", { class: `person-btn ${className}` }, ...kids) : h("button", { type: "button", class: `person-btn ${className}`, "aria-label": `${p.name}'s profile`, onclick: (ev) => { ev.stopPropagation(); openProfile(p.user_id); } }, ...kids);

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
      h("label", { class: "setting" }, h("div", null, h("strong", null, "Share where I study"), h("small", null, "So friends can come and join you")), share),
      musicSetting(),
      canNotify ? h("div", { class: "setting" }, h("div", null, h("strong", null, "Notifications"), h("small", null, Notification.permission === "granted" ? "On while Locked In is open" : "When a friend locks in or pings you")),
        Notification.permission === "granted" ? h("span", { class: "pill" }, "✓ On") : h("button", { class: "btn btn-small btn-soft", onclick: async () => { await Notification.requestPermission(); render(); } }, "Turn on")) : null,
      h("div", { class: "setting" }, h("div", null, h("strong", null, "Your other devices"), h("small", null, "Use this account on your laptop or another phone")), h("button", { class: "btn btn-small btn-soft", onclick: showPairingCode }, "Add a device"))),
    h("div", { class: "section-head", style: { marginTop: "26px" } }, h("h2", null, "Crews"), h("button", { class: "btn btn-small btn-soft", onclick: crewSheet }, "+ Join / start")),
    h("div", { class: "card" }, state.crews.map((c) => h("div", { class: "crew-row" },
      h("div", null, h("strong", null, c.name), h("p", { class: "small muted" }, `${c.members} ${c.members === 1 ? "member" : "members"} · code `, h("b", null, c.code))),
      h("div", { class: "crew-actions" },
        h("button", { class: "btn btn-small", onclick: () => shareInvite(c) }, "Invite"),
        h("button", { class: "link", onclick: () => leaveCrew(c) }, "Leave"))))),
    watchersCard(),
    linkingCard(),
    h("div", { class: "card", style: { marginTop: "16px" } },
      h("p", { class: "small muted" }, "Your account lives on the devices you've added. Before clearing this browser's data, add another device so you don't lose it. On a phone, Share → Add to Home Screen keeps it handy."),
      h("button", { class: "link", style: { marginTop: "8px" }, onclick: () => enterCode({ switching: true }) }, "Switch this device to another account"),
      h("button", { class: "link", style: { color: "var(--danger)", marginTop: "2px" }, onclick: deleteEverything }, "Delete my account and sessions")));
}

/* ------------------------------------------------------------
   Devices: a short code from one device signs another in as you
   ------------------------------------------------------------ */

async function showPairingCode() {
  const { data, error } = await db.rpc("create_pairing_code");
  if (error) return oops(error);
  const until = new Date(data.expires_at);
  const left = h("p", { class: "muted", style: { marginTop: "10px", fontWeight: "800", textAlign: "center" } }, "Expires in 10:00");
  sheet((box, done) => box.append(
    h("h2", null, "Add a device 📱💻"),
    h("p", { class: "muted", style: { marginTop: "6px" } }, "On the other device, open Locked In and tap ", h("b", null, "I already use Locked In on another device"), ", then enter:"),
    h("p", { class: "code pair-code", "aria-label": `Code ${data.code.split("").join(" ")}` }, `${data.code.slice(0, 3)} ${data.code.slice(3)}`),
    left,
    h("p", { class: "small muted", style: { marginTop: "6px" } }, "It works once. Keep it to yourself — whoever types it in becomes you."),
    h("div", { class: "btn-row" }, h("button", { class: "btn btn-soft", onclick: done }, "Done"), h("button", { class: "btn", onclick: () => { done(); showPairingCode(); } }, "New code"))));
  const timer = setInterval(() => {
    if (!left.isConnected) return clearInterval(timer);
    const seconds = Math.max(0, Math.round((+until - Date.now()) / 1000));
    left.textContent = seconds ? `Expires in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : "Expired — make a new code.";
  }, 1000);
}

function enterCode({ switching = false } = {}) {
  const input = h("input", { id: "pair-code", class: "input pair-input", maxlength: 7, placeholder: "ABC 123", autocapitalize: "characters", autocomplete: "one-time-code", spellcheck: "false", "aria-label": "Code from your other device" });
  sheet((box, close) => box.append(
    h("h2", null, switching ? "Switch account" : "Welcome back 👋"),
    h("p", { class: "muted", style: { marginTop: "6px" } }, "On a device where you're signed in, go to Me → ", h("b", null, "Add a device"), " and type the code here."),
    switching && state.me ? h("p", { class: "small", style: { marginTop: "10px", color: "var(--danger)", fontWeight: "800" } }, `This device stops being ${state.me.name}. That account's sessions stay on the board, so delete it first if it was a mistake.`) : null,
    h("form", { style: { marginTop: "16px" }, onsubmit: async (ev) => {
      ev.preventDefault();
      const go = ev.currentTarget.querySelector("button[type=submit]");
      go.disabled = true;
      try { await pairWith(input.value); }
      catch (error) { oops(error); go.disabled = false; }
    } },
      input,
      h("div", { class: "btn-row" }, h("button", { class: "btn btn-soft", type: "button", onclick: close }, "Cancel"), h("button", { class: "btn", type: "submit" }, "Sign in")))), { focus: input });
}

async function pairWith(code) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: code.trim() }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.token_hash) throw new Error(body.error || "That didn't work. Try a new code.");
  if (channel) { db.removeChannel(channel); channel = null; }
  const { error } = await db.auth.verifyOtp({ token_hash: body.token_hash, type: "email" });
  if (error) throw error;
  // Start clean as the account this device has just become.
  location.reload();
}

/* ------------------------------------------------------------
   Watch links: a read-only page of just you, for someone without
   an account (family, say). Never where you are, never your crew.
   ------------------------------------------------------------ */

function watchersCard() {
  return [
    h("div", { class: "section-head", style: { marginTop: "26px" } }, h("h2", null, "Let someone watch")),
    h("div", { class: "card" },
      h("p", { class: "small" }, "A link for family, or anyone without an account. It shows whether you're studying now, on what and where, how long you've studied, and your crew's board."),
      state.watchers.map((w) => h("div", { class: "setting" },
        h("div", null, h("strong", null, w.label), h("small", null, w.last_seen_at ? `Last looked ${ago(w.last_seen_at)}` : "Not opened yet")),
        h("button", { class: "link", onclick: () => stopWatchLink(w) }, "Turn off"))),
      h("button", { class: "btn btn-small btn-soft", style: { marginTop: "12px" }, onclick: makeWatchLink }, state.watchers.length ? "Make another link" : "Make a link")),
  ];
}

function makeWatchLink() {
  const label = h("input", { class: "input", maxlength: 30, placeholder: "Mum and Dad", autocomplete: "off" });
  sheet((box, close) => box.append(
    h("h2", null, "Let someone watch 👀"),
    h("p", { class: "muted", style: { marginTop: "6px" } }, "They'll see whether you're studying now and how long, and your crew's board, without needing an account. Where people study shows only for those who share it with the crew."),
    h("form", { onsubmit: async (ev) => {
      ev.preventDefault();
      const who = label.value.trim() || "Family";
      const { data: token, error } = await db.rpc("create_watch_link", { p_label: who });
      if (error) return oops(error);
      close();
      await refresh(); render();
      showWatchLink(who, `${location.origin}${location.pathname}#watch=${token}`);
    } },
      h("label", { class: "field" }, h("span", { class: "label" }, "Who's it for?"), label),
      h("div", { class: "btn-row" }, h("button", { class: "btn btn-soft", type: "button", onclick: close }, "Cancel"), h("button", { class: "btn", type: "submit" }, "Make link")))), { focus: label });
}

function showWatchLink(who, url) {
  sheet((box, close) => box.append(
    h("h2", null, `${who}'s link 🔗`),
    h("p", { class: "muted", style: { marginTop: "6px" } }, "It's shown once, so send it now. Anyone with it can see your study time, so only give it to them. You can turn it off any time in Me."),
    h("div", { class: "code-box" }, url),
    "share" in navigator ? h("button", { class: "btn btn-block", style: { marginTop: "14px" }, onclick: () => navigator.share({ title: `${state.me.name} on Locked In`, url }).catch(() => {}) }, "Send it…") : null,
    h("div", { class: "btn-row" }, h("button", { class: "btn btn-soft", onclick: () => copy(url, "Link copied.") }, "Copy link"), h("button", { class: "btn btn-soft", onclick: close }, "Done"))));
}

async function stopWatchLink(w) {
  if (!confirm(`Turn off ${w.label}'s link? It stops working straight away.`)) return;
  const { error } = await db.from("watch_links").delete().eq("id", w.id);
  if (error) return oops(error);
  await refresh(); render();
  toast("Link turned off.");
}

/** The page a watch link opens: one person, read-only, checking in every minute. */
async function watchPage(token) {
  // Added to a phone's home screen, this page should open again, not the app's sign-up.
  document.querySelector('link[rel="manifest"]')?.remove();
  let shown = false;
  async function load() {
    const { data, error } = await db.rpc("watch_stats", { p_token: token, p_tz: TZ });
    if (!error && data) { shown = true; return paintWatch(data); }
    if (error?.code === "28000") return app().replaceChildren(h("main", { class: "welcome" },
      h("div", { class: "welcome-lock", "aria-hidden": "true" }, "🔒"), h("h1", null, "This link is off"), h("p", null, error.message)));
    // A blip while the page is already up: keep it, and try again next minute.
    if (!shown) app().replaceChildren(h("main", { class: "welcome" },
      h("div", { class: "welcome-lock", "aria-hidden": "true" }, "😵"), h("h1", null, "Couldn't connect"), h("p", null, "Check your connection and reload.")));
  }
  await load();
  // Nobody types on this page, so it can update itself whenever there's a new version.
  let minutes = 0;
  setInterval(() => { if (!document.hidden) { load(); if (++minutes % 5 === 0) updateIfStale(); } }, 60000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
}

const WATCH_TAB_KEY = "lockedin.watchTab";

/** A watch link's page: the person who shared it, and their crew's board. `data` is what watch_stats returned. */
function paintWatch(data) {
  state.watching = data;
  state.user = { id: data.me };
  state.people = data.people;
  state.liveRows = new Map(data.live.map((row) => [row.user_id, row]));
  state.breaks = data.live.filter((row) => !row.started_at && row.paused_at && byId(row.user_id));
  state.feed = data.feed;
  const who = { ...EMPTY_STATS, ...byId(data.me) };
  document.title = `${who.name} · Locked In`;
  const tab = readStored(WATCH_TAB_KEY) === "crew" ? "crew" : "person";
  const tabButton = (key, icon, label) => h("button", { class: "tab", "aria-current": tab === key ? "page" : null, onclick: () => { store(WATCH_TAB_KEY, key); paintWatch(data); scrollTo({ top: 0 }); } }, h("b", null, icon), label);
  app().replaceChildren(
    h("header", { class: "top" },
      h("div", { class: "brand" }, h("span", { class: "brand-lock", "aria-hidden": "true" }, "🔒"), "Locked In"),
      h("span", { class: "pill" }, "👀 Watching")),
    h("main", { class: "watch" }, tab === "crew" ? watchCrew() : watchPerson(who, data)),
    h("nav", { class: "tabs watch-tabs", "aria-label": "Sections" }, tabButton("person", who.emoji, who.name), tabButton("crew", "🏆", "Board")));
  tick();
}

/** The person who shared the link: studying now or not, then their profile. */
function watchPerson(who, { sessions }) {
  const row = state.liveRows.get(who.user_id);
  const last = sessions[0];
  const today = `Today: ${who.today_minutes ? hm(who.today_minutes) : "nothing yet"}`;
  const status = who.live_started_at
    ? h("section", { class: "card running" },
      h("span", { class: "running-tag" }, "STUDYING NOW"),
      h("h2", null, who.live_subject),
      sittingClock({ started_at: who.live_started_at, banked_seconds: row?.banked_seconds }, "big-clock"),
      who.live_location ? h("p", { class: "running-where" }, "📍 ", who.live_location) : null,
      playingLine(row?.now_playing),
      h("p", { class: "running-where" }, today))
    : h("section", { class: `card watch-status${row?.paused_at ? " is-break" : ""}` },
      h("strong", null, row?.paused_at ? `☕ On a break since ${timeOf(row.paused_at)}` : "Not studying right now"),
      h("p", null, today),
      !row?.paused_at && last ? h("small", null, `Last: ${last.subject}, ${new Date(last.ended_at).toLocaleDateString("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" })} ${timeOf(last.started_at)}–${timeOf(last.ended_at)}${last.location ? ` · 📍 ${last.location}` : ""}`) : null);
  return [
    status,
    heroCard(who),
    activityCard(who, sessions, "Activity"),
    recentSessions(sessions, who.name, 10),
    h("p", { class: "small muted watch-note" }, `${who.name} shared this page with you. It keeps itself up to date, and ${who.name} can turn the link off at any time.`),
  ];
}

/** Everyone in the crew: who's studying right now, and the board. */
function watchCrew() {
  const live = state.people.filter((p) => p.live_started_at).sort((a, b) => +new Date(a.live_started_at) - +new Date(b.live_started_at));
  return [
    h("section", { class: "section watch-live" },
      h("div", { class: "section-head" }, h("h2", null, "Locked in right now"), h("small", null, [live.length ? `${live.length} studying` : "", state.breaks.length ? `${state.breaks.length} on a break` : ""].filter(Boolean).join(" · "))),
      live.length || state.breaks.length
        ? [...live.map(liveCard), ...state.breaks.map(breakCard)]
        : h("div", { class: "card empty" }, h("span", { class: "big" }, "🦗"), "Nobody's locked in right now.")),
    h("div", { class: "section" }, boardView()),
  ];
}

/* ------------------------------------------------------------
   Sheets
   ------------------------------------------------------------ */

/** Only on a browser that opened ?link, or that already has a link. */
function linkingCard() {
  if (readStored(LINKING_KEY) !== "1" && !state.keys.length) return null;
  return [
    h("div", { class: "section-head", style: { marginTop: "26px" } }, h("h2", null, "Linked app")),
    h("div", { class: "card" },
      h("p", { class: "small" }, "Sync your timers with another app of yours, both ways. A link can only ever act as you."),
      state.keys.map((k) => h("div", { class: "setting" }, h("div", null, h("strong", null, k.label), h("small", null, k.last_used_at ? `Last synced ${ago(k.last_used_at)}` : "Not used yet")),
        h("button", { class: "link", onclick: () => revokeKey(k) }, "Unlink"))),
      h("button", { class: "btn btn-small btn-soft", style: { marginTop: "12px" }, onclick: makeLinkCode }, state.keys.length ? "Make a new code" : "Link an app")),
  ];
}

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

/** What's wrong with these times before the database is asked, or null. */
function timingProblem(start, end) {
  if (+end > Date.now() + 60000) return "That ends in the future. Save it once it's happened.";
  if (+end - +start > MAX_SESSION_MS) return "Keep a session under 16 hours.";
  if (+end - +start < MIN_SESSION_MS) return "A session needs at least a minute.";
  if (state.live && +end > +new Date(state.live.started_at)) return "That runs into the timer you have going now.";
  return null;
}

/** The latest moment, up to now, that a St Andrews clock read this ("HH:MM"). */
function lastTimeAt(value, now = new Date()) {
  const at = ukAt(ukDay(now), value);
  return at > now ? ukAt(ukDay(now), value, -1) : at;
}

/** Fix the timer that's running: the module, when you really started, where you are, or when you stopped and forgot to say. */
function editTimerSheet() {
  const live = state.live;
  if (!live) return;
  const names = [...new Set([live.subject, ...activeModules().map((m) => m.name)])];
  const subject = h("select", { class: "input" }, names.map((name) => h("option", { value: name, selected: name === live.subject }, name)));
  const from = h("input", { class: "input", type: "time", value: timeOf(live.started_at) });
  const place = h("input", { class: "input", maxlength: 80, value: live.location || "", placeholder: "Main Library, café, home…" });
  const save = h("button", { class: "btn" }, "Save");
  const to = h("input", { class: "input", type: "time", "aria-describedby": "stopped-hint", oninput: () => { save.textContent = to.value ? "Save and stop" : "Save"; } });
  save.addEventListener("click", async () => {
    if (!from.value) return toast("Pick when you started.", { bad: true });
    const now = new Date();
    // An unchanged time keeps its seconds; a changed one is the latest time it's been that o'clock.
    const start = from.value === timeOf(live.started_at) ? new Date(live.started_at) : lastTimeAt(from.value, now);
    const end = to.value ? lastTimeAt(to.value, now) : null;
    if (end && end <= start) return toast(`That's before you started, at ${timeOf(start)}.`, { bad: true });
    if (end && +end - +start < MIN_SESSION_MS) return toast("A session needs at least a minute.", { bad: true });
    if (+(end || now) - +start > MAX_SESSION_MS) return toast(end ? "Keep a session under 16 hours." : "A timer can go back 16 hours at most.", { bad: true });
    // The database only checks sessions against each other, so check the running one here.
    const clash = state.mine.find((s) => +new Date(s.ended_at) > +start && +new Date(s.started_at) < +(end || now));
    if (clash) return toast(`That would overlap your ${clash.subject} session, which ended at ${timeOf(clash.ended_at)}.`, { bad: true });
    // Editing it counts as being here.
    const row = { subject: subject.value, started_at: start.toISOString(), checked_at: now.toISOString(), ...(state.me.share_location ? { location: place.value.trim() || null } : {}) };
    // Only this timer: if it was stopped or replaced on another device, nothing changes.
    const { data, error } = await db.from("live").update(row).eq("user_id", state.user.id).eq("session_id", live.session_id)
      .select("session_id, subject, started_at, location, banked_seconds, checked_at");
    if (error) return oops(error);
    if (!data?.length) { close(); await refresh(); render(); return toast("That timer isn't running any more.", { bad: true }); }
    state.live = { ...live, ...data[0] };
    close();
    if (end) return finish({ end });
    render(); refreshSoon();
    toast("Timer updated.");
  });
  const close = sheet((box, close) => box.append(
    h("h2", null, "Edit your timer"),
    h("p", { class: "muted", style: { marginTop: "4px" } }, "Wrong module, started before you pressed the button, or forgot to stop? Fix it here."),
    h("label", { class: "field" }, h("span", { class: "label" }, "Module"), subject),
    h("label", { class: "field" }, h("span", { class: "label" }, "Started at"), from),
    h("label", { class: "field" }, h("span", { class: "label" }, "Stopped at"), to,
      h("span", { id: "stopped-hint", class: "small muted", style: { display: "block", marginTop: "6px" } }, "Forgot to stop it? Set when you did and it ends there. Leave it empty to keep going.")),
    state.me.share_location ? h("label", { class: "field" }, h("span", { class: "label" }, "Where (your crew sees this)"), place) : null,
    h("div", { class: "btn-row" }, h("button", { class: "btn btn-soft", onclick: close }, "Cancel"), save)));
}

/** The database's refusals, in words. */
function sessionError(error) {
  if (error.message?.includes("sessions_no_overlap")) return { message: "That overlaps a session you already have." };
  if (error.message?.includes("sessions_length")) return { message: "Keep a session under 16 hours." };
  return error;
}

/** Log a session you forgot to time, or fix one you already have: its module, day and times. */
function sessionSheet(session = null) {
  const modules = activeModules();
  if (!session && !modules.length) return addModuleSheet(() => sessionSheet());
  const now = new Date();
  const was = session ? { start: new Date(session.started_at), end: new Date(session.ended_at) } : { start: new Date(+now - 3600000), end: now };
  // A session on a module you've since archived keeps its name as an option.
  const names = [...new Set([...(session ? [session.subject] : []), ...modules.map((m) => m.name)])];
  const chosen = session ? session.subject : state.subject;
  const subject = h("select", { class: "input" }, names.map((name) => h("option", { value: name, selected: name === chosen }, name)));
  const day = h("input", { class: "input", type: "date", value: ukDay(was.start), max: ukDay(now), "aria-label": "Day" });
  const from = h("input", { class: "input", type: "time", value: timeOf(was.start), "aria-label": "Started" });
  const to = h("input", { class: "input", type: "time", value: timeOf(was.end), "aria-label": "Finished" });
  sheet((box, close) => box.append(
    h("h2", null, session ? "Edit session" : "Log a session"),
    h("p", { class: "muted", style: { marginTop: "4px" } }, session ? "Fix the module or the times. The board updates too." : "For when you forgot to lock in."),
    h("label", { class: "field" }, h("span", { class: "label" }, "Module"), subject),
    h("div", { class: "form-grid", style: { marginTop: "14px" } }, day, from, to),
    h("div", { class: "btn-row" }, h("button", { class: "btn btn-soft", onclick: close }, "Cancel"),
      h("button", { class: "btn", onclick: async () => {
        const start = ukAt(day.value, from.value);
        let end = ukAt(day.value, to.value);
        if (!Number.isFinite(+start) || !Number.isFinite(+end)) return toast("Pick a day and both times.", { bad: true });
        // Finishing "before" you started means you went past midnight.
        if (end <= start) end = ukAt(day.value, to.value, 1);
        const problem = timingProblem(start, end);
        if (problem) return toast(problem, { bad: true });
        const row = { subject: subject.value, started_at: start.toISOString(), ended_at: end.toISOString() };
        // Row-level security turns a refused change into "nothing changed", so ask for the row back.
        const { data, error } = session
          ? await db.from("sessions").update(row).eq("id", session.id).select("id")
          : await db.from("sessions").insert({ user_id: state.user.id, ...row }).select("id");
        if (error) return oops(sessionError(error));
        if (!data?.length) return oops({ message: "That session isn't there any more." });
        close(); await refresh(); render();
        const change = Math.round((end - start) / 60000 - (session ? minutesBetween(session.started_at, session.ended_at) : 0));
        if (!session) toast(`+${change} XP logged ⭐️`);
        else toast(change ? `Session updated · ${change > 0 ? "+" : "−"}${Math.abs(change)} XP` : "Session updated.");
      } }, "Save"))));
}

async function removeSession(session) {
  if (!confirm(`Delete ${session.subject} (${hm(minutesBetween(session.started_at, session.ended_at))})? It comes off the board too.`)) return;
  const { error } = await db.from("sessions").delete().eq("id", session.id);
  if (error) return oops(error);
  await refresh(); render();
}

async function makeLinkCode() {
  const { data: link, error } = await db.rpc("create_link_key");
  if (error) return oops(error);
  const code = encodeLinkCode({ url: SUPABASE_URL, key: SUPABASE_KEY, link });
  await refresh(); render();
  sheet((box, close) => box.append(
    h("h2", null, "Your link code 🔗"),
    h("p", { class: "muted", style: { marginTop: "6px" } }, "Paste it into the app you're linking. It's shown once — anyone with it can log time as you, so keep it to yourself."),
    h("div", { class: "code-box" }, code),
    h("div", { class: "btn-row" }, h("button", { class: "btn btn-soft", onclick: close }, "Done"), h("button", { class: "btn", onclick: () => copy(code, "Code copied.") }, "Copy code"))));
}

async function revokeKey(key) {
  if (!confirm("Unlink this app? It stops syncing straight away.")) return;
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
  // data-banked is a sitting's time from before its breaks, in seconds.
  for (const node of document.querySelectorAll("[data-since]")) node.textContent = clock(now - +new Date(node.dataset.since) + (Number(node.dataset.banked) || 0) * 1000);
  for (const node of document.querySelectorAll("[data-xp-since]")) node.textContent = String(Math.floor((now - +new Date(node.dataset.xpSince) + (Number(node.dataset.banked) || 0) * 1000) / 60000));
}
setInterval(() => { if (!document.hidden) tick(); }, 1000);
document.addEventListener("visibilitychange", () => { if (!document.hidden && state.me && state.crews.length) refreshSoon(); });

/* ------------------------------------------------------------
   Updates. Browsers keep these files for 10 minutes (GitHub Pages'
   cache) and a page left open never fetches them again, so a phone
   can go on running an old version. Compare the copy this page runs
   with the server's; if they differ, refresh the cached files and
   reload. Checked on opening and on coming back to the app (nobody's
   mid-typing then), and every few minutes on a watch page.
   ------------------------------------------------------------ */

const APP_FILES = ["./", "app.js", "game.mjs", "config.js", "styles.css"];
const versionOf = (res) => res.headers.get("etag") || res.headers.get("last-modified");

async function updateIfStale() {
  try {
    const running = versionOf(await fetch("app.js", { cache: "force-cache" }));
    const latest = versionOf(await fetch("app.js", { method: "HEAD", cache: "no-store" }));
    if (!running || !latest || running === latest) return;
    // Once per version, so a cache that won't let go can't keep reloading the page.
    if (sessionStorage.getItem("lockedin.updatedTo") === latest) return;
    sessionStorage.setItem("lockedin.updatedTo", latest);
    await Promise.all(APP_FILES.map((file) => fetch(file, { cache: "reload" })));
    location.reload();
  } catch (_) { /* offline, or storage blocked: the next check tries again */ }
}
updateIfStale();
document.addEventListener("visibilitychange", () => { if (!document.hidden) updateIfStale(); });
// A different watch link pasted into the same tab only changes the #, which doesn't reload by itself.
addEventListener("hashchange", () => location.reload());

boot().catch((error) => {
  console.error(error);
  app().replaceChildren(h("main", { class: "welcome" }, h("div", { class: "welcome-lock" }, "😵"), h("h1", null, "Couldn't connect"), h("p", null, error.message || "Check your connection and reload.")));
});
