// Locked In — one page, three tabs, Supabase for everything.
//
// Accounts are anonymous: a name and an emoji, kept in this browser. What
// you can see is decided by the database (you, and whoever shares a crew
// with you), so this file never filters anything for privacy.

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm";
import { SUPABASE_URL, SUPABASE_KEY, MUSIC } from "./config.js";
import { levelProgress, ranksFor, streakFrom, badgesFor, badgeProgress, addsUp, nextBadges, listNames, studyGroups, pingLines, BADGES, BADGE_GROUPS, standings, chaseLine, hm, clock, untilReset, ago, TZ, ukDay, ukAt, dayStart, encodeLinkCode, weekStart, weeksFrom, subjectsBetween, hourTicks, shortHours, sittingMs, onBreak, BREAK_KEPT_MS, BREAK_SHOWN_MS, hiddenFrom, longStretch, unconfirmed, rankedFor, TIERS, RANKED_WEEKS, weekHours, tierMove, COINS_PER_HOUR, SHOP, SHOP_KINDS, shopItem, REACTIONS, CHEERS, reactionChips, groupedLines } from "./game.mjs";

const db = createClient(SUPABASE_URL, SUPABASE_KEY);
const EMOJI = [
  "📚",
  "🦊", "🐼", "🐯", "🦁", "🐨", "🐵", "🦄", "🐶", "🐱", "🐭", "🐹", "🐰", "🐻", "🐮", "🐷", "🐴", "🐺", "🦝", "🦔", "🐿️", "🦇", "🦥", "🦦", "🦘", "🐘", "🦒", "🦓", "🦏", "🦌", "🐑", "🐐", "🦙", "🐫", "🦍",
  "🦉", "🐧", "🐔", "🐥", "🦆", "🦅", "🦩", "🦚", "🦜",
  "🐸", "🐢", "🐊", "🦎", "🐍", "🦖",
  "🐳", "🐙", "🐠", "🦈", "🐬", "🦭", "🦀",
  "🐌", "🐝", "🦋", "🐞",
  "🌵", "🍄", "⚡️", "🚀", "🎧", "☕️", "🧠",
];
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
const CHAT_CREW_KEY = "lockedin.chatCrew";
// When you last saw each crew's chat, on this device: { crewId: ISO time }.
const CHAT_READ_KEY = "lockedin.chatRead";

const state = {
  user: null, me: null, crews: [], people: [], live: null, paused: null, breaks: [], liveRows: new Map(), music: null, feed: [], mine: [], keys: [], watchers: [], modules: [],
  // On a watch link's page: what it last loaded. Read-only, and "you" means the person who shared it.
  watching: null,
  // Crew chat: the latest messages across your crews (for unread counts), and the open crew's conversation.
  recent: [], chat: { crew: null, messages: [], loaded: false },
  // Everyone's records for badges (crew_badges): user id → facts.
  badgeFacts: new Map(),
  // Hypes and "I'm coming"s you haven't said you've seen yet.
  pings: [],
  // On a watch page: the link's secret, for sending a cheer.
  watchToken: null,
  // What everyone's wearing and the treats they've been given (crew_flair): user id → { frame, color, tag, treats }.
  flair: new Map(),
  // Your coins and the things you have to wear (my_wallet).
  wallet: { coins: 0, owned: [] },
  // Gifts from crewmates and cheers from watch links you haven't said you've seen yet.
  gifts: [], cheers: [],
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
/** Someone's ranked tier (see rankedFor): worked out once when the crew loads, or here for anyone else. */
const withRanked = (p) => { const ranked = rankedFor(p.days || {}); return { ...p, ranked, ranked_minutes: Math.round(ranked.average) }; };
const rankedOf = (p) => p?.ranked || rankedFor(p?.days || {});
const flairOf = (id) => state.flair.get(id) || {};
/** Someone's emoji in its circle, inside the frame they wear. */
const avatar = (p, extra = "") => h("span", { class: `avatar${extra ? ` ${extra}` : ""}`, dataset: flairOf(p?.user_id).frame ? { frame: flairOf(p.user_id).frame } : {}, "aria-hidden": "true" }, p?.emoji || "👤");
/** Their name, in the colour they wear. */
const nameIn = (p, tag = "span", name = p.name) => h(tag, { class: "who-name", dataset: flairOf(p.user_id).color ? { color: flairOf(p.user_id).color } : {} }, name);
/** A tier's emblem. Next to a name it's left out for someone unranked. */
const gem = (tier, extra = "") => h("i", { class: `gem${extra ? ` ${extra}` : ""}`, dataset: { tier: tier?.id || "none" }, role: "img", title: tier ? `${tier.name} tier` : "Unranked", "aria-label": tier ? `${tier.name} tier` : "Unranked" });
const gemOf = (p) => { const tier = rankedOf(p).tier; return tier ? gem(tier) : null; };
/** What's been seen on this device, by its newest id: "pings", "gifts" or "cheers". */
const seenOf = (what) => Number(readStored(`lockedin.${what}Seen.${state.user.id}`)) || 0;
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
  const grid = h("div", { class: "emoji-grid", role: "group", "aria-label": "Pick your emoji" },
    EMOJI.map((e) => h("button", { type: "button", class: "emoji-pick", "aria-pressed": String(e === current), "aria-label": e, onclick: (ev) => {
      ev.currentTarget.parentNode.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === ev.currentTarget)));
      onPick(e);
    } }, e)));
  // It's a long list: open on the one that's picked, once the grid is on the page.
  requestAnimationFrame(() => {
    const picked = grid.querySelector('[aria-pressed="true"]');
    if (picked) grid.scrollTop = picked.offsetTop - (grid.clientHeight - picked.offsetHeight) / 2;
  });
  return grid;
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
    h("p", null, "Add your modules — course names, codes, anything you want to time. Your crew sees your time on each one you study, and you can change the list any time."),
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
  const seenPings = seenOf("pings");
  const dayAgo = new Date(Date.now() - 86400000).toISOString();
  // Like pings: what's newer than this device has seen, or the last day on a new device.
  const unseen = (query, what) => (seenOf(what) ? query.gt("id", seenOf(what)) : query.gt("created_at", dayAgo)).order("id", { ascending: false }).limit(50);
  const [stats, live, feed, mine, keys, modules, watchers, recent, records, pings, flair, wallet, gifts, cheers] = await Promise.all([
    db.rpc("room_stats", { p_tz: TZ }),
    // Yours and your crewmates', as the database allows: who's studying, who's on a break.
    db.from("live").select("user_id, session_id, subject, started_at, sitting_started_at, location, paused_at, paused_subject, banked_seconds, now_playing, checked_at, study_group"),
    db.from("sessions").select("id, user_id, subject, started_at, ended_at, location").order("ended_at", { ascending: false }).limit(25),
    db.from("sessions").select("id, subject, started_at, ended_at, location").eq("user_id", uid).gte("started_at", new Date(Date.now() - 70 * 86400000).toISOString()).order("started_at", { ascending: false }).limit(400),
    db.from("link_keys").select("id, label, created_at, last_used_at").order("created_at"),
    db.rpc("my_subject_stats", { p_tz: TZ }),
    db.from("watch_links").select("id, label, created_at, last_seen_at").order("created_at"),
    db.from("messages").select("id, crew_id, user_id, created_at").order("created_at", { ascending: false }).limit(60),
    db.rpc("crew_badges", { p_tz: TZ }),
    // A new device looks back a day rather than through everything ever sent.
    (seenPings ? db.from("pings").select(PING_COLUMNS).eq("to_user", uid).gt("id", seenPings) : db.from("pings").select(PING_COLUMNS).eq("to_user", uid).gt("created_at", dayAgo)).order("id", { ascending: false }).limit(50),
    db.rpc("crew_flair"),
    db.rpc("my_wallet"),
    // Things given to you by someone else (or by someone who's since left).
    unseen(db.from("items").select(GIFT_COLUMNS).eq("user_id", uid).or(`paid_by.is.null,paid_by.neq.${uid}`), "gifts"),
    unseen(db.from("watch_cheers").select(CHEER_COLUMNS).eq("user_id", uid), "cheers"),
    loadCrews(),
  ]);
  if (MUSIC) db.rpc("my_music").then(({ data }) => { if (data) { const changed = JSON.stringify(data) !== JSON.stringify(state.music); state.music = data; if (changed && state.tab === "me") keepFocus(render); } });
  const failed = [stats, live, feed, mine, keys, modules, watchers, recent, records].find((r) => r.error);
  if (failed) return oops(failed.error, "Couldn't load your crew.");
  state.people = (stats.data || []).map(withRanked);
  // The extras never stop the app loading: without them people just look plain.
  if (flair.data) state.flair = new Map(flair.data.map((row) => [row.user_id, row]));
  if (wallet.data) state.wallet = wallet.data;
  if (gifts.data) state.gifts = gifts.data;
  if (cheers.data) state.cheers = cheers.data;
  state.liveRows = new Map((live.data || []).map((row) => [row.user_id, row]));
  const own = state.liveRows.get(uid);
  state.live = own?.started_at ? own : null;
  state.paused = onBreak(own, BREAK_KEPT_MS) ? own : null;
  state.breaks = (live.data || []).filter((row) => row.user_id !== uid && byId(row.user_id) && onBreak(row, BREAK_SHOWN_MS));
  state.feed = feed.data || [];
  state.mine = mine.data || [];
  state.keys = keys.data || [];
  state.watchers = watchers.data || [];
  state.recent = recent.data || [];
  state.badgeFacts = new Map((records.data || []).map((row) => [row.user_id, row.facts]));
  announceBadges();
  announceTier();
  state.modules = modules.data || [];
  if (pings.data) state.pings = pings.data;
  showPings();
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
      const mine = row?.user_id === state.user.id;
      // Straight away, not after the refresh: the next event may be someone joining the group this just made.
      if (mine && state.live) state.live = { ...state.live, study_group: row.study_group };
      if (!mine && before && row.study_group && row.study_group === state.live?.study_group && state.liveRows.get(row.user_id)?.study_group !== row.study_group) {
        state.liveRows.set(row.user_id, row);
        notify(`👯 ${before.emoji} ${before.name} locked in with you`);
      }
      // Coming back from a break, or saying "still here", isn't news; locking in is.
      else if (row?.started_at && !row.banked_seconds && !row.checked_at && row.user_id !== state.user.id && before && !before.live_started_at) {
        notify(`${before.emoji} ${before.name} just locked in on ${row.subject}${row.location ? ` at ${row.location}` : ""}`);
      }
      refreshSoon();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "sessions" }, refreshSoon)
    // New crewmates and renamed ones. Inserts and updates only: those are RLS-checked, deletes aren't.
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "crew_members" }, refreshSoon)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles" }, refreshSoon)
    // RLS lets through only your crews' messages. A delete arrives as just an id, for whoever's listening.
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, ({ new: message }) => gotMessage(message))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, ({ new: message }) => changedMessage(message))
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "messages" }, ({ old }) => lostMessage(old?.id))
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "reactions" }, ({ new: reaction }) => gotReaction(reaction))
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "reactions" }, ({ old }) => lostReaction(old))
    // A gift for you, or a cheer from someone watching: it waits on the card like a hype.
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "items", filter: `user_id=eq.${state.user.id}` }, ({ new: gift }) => {
      if (gift.paid_by === state.user.id) return;
      if (document.hidden) notify(`🎁 ${byId(gift.paid_by)?.name || "Someone"} sent you ${giftLabel(gift.item)}!`);
      state.gifts = [gift, ...state.gifts.filter((other) => other.id !== gift.id)];
      showPings();
      refreshSoon();
    })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "watch_cheers", filter: `user_id=eq.${state.user.id}` }, ({ new: cheer }) => {
      if (document.hidden) notify(`${cheerEmoji(cheer.kind)} ${cheer.from_label} is cheering you on!`);
      state.cheers = [cheer, ...state.cheers.filter((other) => other.id !== cheer.id)];
      showPings();
    })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "pings", filter: `to_user=eq.${state.user.id}` }, ({ new: ping }) => {
      const who = byId(ping.from_user);
      // The card waits for them. A notification is for reaching them now, if they're elsewhere.
      if (document.hidden) notify(ping.kind === "joining" ? `🏃 ${who?.name || "Someone"} is on the way to join you!` : `🔥 ${who?.name || "Someone"} is cheering you on!`);
      state.pings = [ping, ...state.pings.filter((other) => other.id !== ping.id)];
      showPings();
    })
    .subscribe();
}

/* ------------------------------------------------------------
   Hypes and "I'm coming". They wait in the database, so one sent while
   you were on another tab or the phone was asleep still reaches you,
   and it stays on screen until you've said you've seen it. What's been
   seen is per device, like chat. The card sits outside #app, so
   repainting the page doesn't replay it.
   ------------------------------------------------------------ */

const PING_COLUMNS = "id, from_user, kind, created_at";
const GIFT_COLUMNS = "id, item, kind, paid_by, created_at";
const CHEER_COLUMNS = "id, from_label, kind, note, created_at";
const pingCard = h("div", { class: "pings", role: "status", hidden: true });
document.body.append(pingCard);
// The newest of each already cheered for on this page, so each only sets off the confetti once.
let pingsCheered = "";

const cheerEmoji = (kind) => CHEERS.find(([key]) => key === kind)?.[1] || "👏";
const WEAR_WORDS = { frame: "frame", color: "name colour", tag: "tag" };
/** "a ☕ Coffee", "the Ember frame". */
function giftLabel(id) {
  const item = shopItem(id);
  if (!item) return "a gift";
  return item.kind === "treat" ? `${item.icon} ${item.name}` : `the ${item.name} ${WEAR_WORDS[item.kind]}`;
}

function showPings() {
  const waiting = { pings: state.pings.filter((x) => x.id > seenOf("pings")), gifts: state.gifts.filter((x) => x.id > seenOf("gifts")), cheers: state.cheers.filter((x) => x.id > seenOf("cheers")) };
  const line = (face, title, at, note = null) => ({ at, node: h("div", { class: "ping-line" },
    face,
    h("div", null, h("strong", null, title), note ? h("p", { class: "ping-note" }, note) : null, h("small", null, ago(at)))) });
  const face = (who, fallback) => (who ? avatar(who) : h("span", { class: "avatar", "aria-hidden": "true" }, fallback));
  const times = (count) => (count > 1 ? ` ×${count}` : "");
  const lines = [
    ...pingLines(waiting.pings).map((ping) => {
      const who = byId(ping.from_user);
      const name = who?.name || "Someone";
      return line(face(who, "🔥"), ping.kind === "joining" ? `${name} is on the way 🏃` : `${name} hyped you${times(ping.count)} 🔥`, ping.last);
    }),
    ...groupedLines(waiting.gifts, (gift) => `${gift.paid_by}:${gift.item}`).map((gift) => {
      const who = byId(gift.paid_by);
      const worn = shopItem(gift.item)?.kind !== "treat";
      return line(face(who, "🎁"), `${who?.name || "Someone"} sent you ${giftLabel(gift.item)}${times(gift.count)} 🎁`, gift.last, worn ? "Put it on in Me → Shop." : null);
    }),
    // A cheer with a note keeps its own line, so every note gets read.
    ...groupedLines(waiting.cheers, (cheer) => `${cheer.from_label}:${cheer.kind}:${cheer.note ? cheer.id : ""}`).map((cheer) =>
      line(face(null, cheerEmoji(cheer.kind)), `${cheer.from_label} sent you ${cheerEmoji(cheer.kind)}${times(cheer.count)}`, cheer.last, cheer.note ? `“${cheer.note}”` : null)),
  ].sort((x, y) => +new Date(y.at) - +new Date(x.at));
  pingCard.hidden = !lines.length;
  pingCard.replaceChildren(...(lines.length ? [...lines.map((x) => x.node), h("button", { class: "btn btn-small", onclick: pingsRead }, "Got it")] : []));
  const newest = ["pings", "gifts", "cheers"].map((what) => Math.max(0, ...waiting[what].map((x) => x.id))).join(":");
  // Only with someone there to see it: a hidden tab has it waiting for when they're back.
  if (!lines.length || document.hidden || newest === pingsCheered) return;
  pingsCheered = newest;
  confetti(waiting.gifts.length ? ["🎁", "🙌", "🔥", "✨"] : ["🔥", "🙌", "🔥", "✨"]);
  pingCard.classList.remove("pop");
  void pingCard.offsetWidth;
  pingCard.classList.add("pop");
}

function pingsRead() {
  for (const what of ["pings", "gifts", "cheers"]) store(`lockedin.${what}Seen.${state.user.id}`, String(Math.max(seenOf(what), ...state[what].map((x) => x.id))));
  state.pings = []; state.gifts = []; state.cheers = [];
  showPings();
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

/** `together` is what joining someone adds: their group, and their place if they have one. Returns whether it worked. */
async function lockIn(together = {}) {
  const subject = state.subject.trim();
  if (!subject) return toast("Pick a module first, or add one.", { bad: true });
  // A new sitting: whatever break was left over ends here.
  const now = new Date().toISOString();
  const row = { user_id: state.user.id, session_id: crypto.randomUUID(), subject, started_at: now, sitting_started_at: now, location: state.place.trim() || null, paused_at: null, paused_subject: null, banked_seconds: 0, study_group: null, ...together };
  const { error } = await db.from("live").upsert(row, { onConflict: "user_id" });
  if (error) return oops(error);
  state.live = row;
  render();
  scrollTo({ top: 0, behavior: "smooth" });
  refreshSoon();
  askMusic();
  return true;
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
  else { if (minutes >= 25) confetti(); toast(`+${Math.round(minutes)} XP${coinsFor(minutes) ? ` · 🪙 +${coinsFor(minutes)}` : ""} · ${hm(minutes)} ${subject ? `on ${subject}` : "this session"} 💪`); }
}

/** About what a stretch of study earns in coins (the database counts them from all your sessions together). */
const coinsFor = (minutes) => Math.floor((minutes * COINS_PER_HOUR) / 60);

/** Before saving 3+ hours in one go, look twice: a forgotten timer is how false records and badges happen. */
function askIfAllOfIt(live, carryOn) {
  sheet((box, close) => box.append(
    h("h2", null, "All of it? 🤔"),
    h("p", { class: "muted", style: { marginTop: "6px" } }, `That's ${hm(minutesBetween(live.started_at, new Date()))} in one go, since ${timeOf(live.started_at)}. Were you studying the whole time?`),
    h("div", { class: "btn-row" },
      h("button", { class: "btn btn-soft", onclick: () => { close(); editTimerSheet(); } }, "No, I stopped earlier"),
      h("button", { class: "btn", onclick: () => { close(); carryOn(); } }, "Yes, all of it"))), { key: "all-of-it" });
}

/** Stops the timer. Under a minute isn't kept; a long stretch gets a second look; past 16 hours we ask when you really stopped. */
async function finish({ discard = false, end: typed = null, reviewed = false } = {}) {
  const live = state.live;
  if (!live) return;
  const end = typed || new Date();
  if (!discard && +end - +new Date(live.started_at) > MAX_SESSION_MS) return askWhenStopped();
  // A time someone typed has had its look already.
  if (!discard && !typed && !reviewed && longStretch(live)) return askIfAllOfIt(live, () => finish({ reviewed: true }));
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
async function pause(reviewed = false) {
  const live = state.live;
  if (!live) return;
  const end = new Date();
  if (+end - +new Date(live.started_at) > MAX_SESSION_MS) return askWhenStopped();
  if (!reviewed && longStretch(live)) return askIfAllOfIt(live, () => pause(true));
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
async function switchModule(name, reviewed = false) {
  const live = state.live;
  if (!live || name === live.subject) return;
  const now = new Date();
  const length = +now - +new Date(live.started_at);
  if (length > MAX_SESSION_MS) return askWhenStopped();
  if (!reviewed && longStretch(live)) return askIfAllOfIt(live, () => switchModule(name, true));
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
async function resume(subject = state.paused?.paused_subject, together = {}) {
  const paused = state.paused;
  if (!paused) return;
  const row = { session_id: crypto.randomUUID(), subject, started_at: new Date().toISOString(), location: paused.location, paused_at: null, paused_subject: null, banked_seconds: paused.banked_seconds, ...together };
  const { error } = await db.from("live").update(row).eq("user_id", state.user.id);
  if (error) return oops(error);
  state.paused = null;
  state.live = { ...paused, ...row };
  render();
  refreshSoon();
  askMusic();
  return true;
}

/** Joining someone you're with: same place and group, your own module and clock. A timer already running just keeps going. */
async function joinGroup(people, subject) {
  const { data, error } = await db.rpc("study_group_with", { p_host: people[0].user_id });
  if (error) { refreshSoon(); return oops(error); }
  const together = { study_group: data.group, ...(data.location ? { location: data.location } : {}) };
  const live = state.live;
  if (live) {
    // Only this timer: if it was stopped or replaced on another device, nothing changes. Joining counts as being here.
    const { data: rows, error: failed } = await db.from("live").update({ ...together, checked_at: new Date().toISOString() }).eq("user_id", state.user.id).eq("session_id", live.session_id).select("session_id");
    if (failed) return oops(failed);
    if (!rows?.length) { await refresh(); render(); return toast("That timer isn't running any more.", { bad: true }); }
    state.live = { ...live, ...together };
    render();
    refreshSoon();
  } else if (state.paused) {
    if (!await resume(subject, together)) return;
  } else {
    state.subject = subject;
    if (!await lockIn(together)) return;
  }
  toast(`👯 Locked in with ${listNames(people.map((p) => p.name))}`);
}

/** Went your separate ways: the timer keeps going, on your own. */
async function leaveGroup() {
  const live = state.live;
  if (!live) return;
  const { error } = await db.from("live").update({ study_group: null }).eq("user_id", state.user.id).eq("session_id", live.session_id);
  if (error) return oops(error);
  state.live = { ...live, study_group: null };
  render();
  refreshSoon();
}

function joinSheet(people) {
  const names = listNames(people.map((p) => p.name));
  const place = people.find((p) => p.live_location)?.live_location;
  const { live, paused } = state;
  let subject = paused ? paused.paused_subject : state.subject;
  const go = h("button", { class: "btn btn-live" });
  const chips = h("div", { class: "chips module-chips", role: "group", "aria-label": "Your modules" });
  function paint() {
    go.textContent = live ? `👯 Join ${names}` : `${paused ? "▶ Resume" : "🔒 Lock in"} with ${names}`;
    go.disabled = !live && !subject;
    const choices = [...new Set([...(paused ? [paused.paused_subject] : []), ...activeModules().map((m) => m.name)])];
    chips.replaceChildren(
      ...choices.map((name) => h("button", { type: "button", class: "chip module-chip", "aria-pressed": String(name === subject), onclick: () => { subject = name; paint(); } }, dot(moduleNamed(name)), name)),
      h("button", { type: "button", class: "chip chip-add", onclick: () => addModuleSheet((added) => { subject = added.name; paint(); }) }, "+ Add"));
  }
  paint();
  sheet((box, close) => {
    go.addEventListener("click", async () => { go.disabled = true; close(); await joinGroup(people, subject); });
    box.append(
      h("h2", null, `Lock in with ${names} 👯`),
      h("p", { class: "muted", style: { marginTop: "6px" } }, live
        ? `Your timer keeps going on ${live.subject}, and you'll show up together on the Now page.`
        : "Your own module and your own clock. You'll show up together on the Now page."),
      live ? null : h("div", { class: "field" }, h("span", { class: "label" }, "What are you studying?"), chips),
      place ? (state.me.share_location
        ? h("p", { class: "running-where" }, "📍 ", place)
        : h("p", { class: "small muted", style: { marginTop: "12px" } }, "Location sharing is off, so your place stays hidden.")) : null,
      h("div", { class: "btn-row" }, h("button", { class: "btn btn-soft", onclick: close }, "Cancel"), go));
  }, { key: "join" });
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
  const unread = unreadTotal();
  const dots = { now: liveOthers, chat: unread > 9 ? "9+" : unread };
  const tab = (key, icon, label) => h("button", { class: "tab", "aria-current": state.tab === key ? "page" : null, onclick: () => { state.tab = key; store(TAB_KEY, key); if (key === "chat") openChat(); else { render(); scrollTo({ top: 0 }); } } },
    h("b", { class: dots[key] ? "tab-dot" : null, dataset: dots[key] ? { count: dots[key] } : {} }, icon), label);
  const views = { now: nowView, board: boardView, chat: chatView, me: meView };
  // In the chat, someone reading the latest messages stays with them as new ones arrive.
  const followChat = state.tab === "chat" && (state.chat.jump || innerHeight + scrollY >= document.documentElement.scrollHeight - 120);
  app().replaceChildren(
    h("header", { class: "top" },
      h("div", { class: "brand" }, h("span", { class: "brand-lock", "aria-hidden": "true" }, "🔒"), "Locked In"),
      h("div", { class: "top-stats" },
        h("button", { type: "button", class: "pill pill-tier", "aria-label": `${rankedOf(me).tier ? `${rankedOf(me).tier.name} tier` : "Unranked"}. See Ranked`, onclick: () => rankedSheet({ ...EMPTY_STATS, ...me, user_id: state.user.id }) }, gem(rankedOf(me).tier)),
        h("span", { class: "pill pill-flame", title: "Days in a row with 30+ minutes" }, "🔥 ", String(streak)),
        h("button", { type: "button", class: "pill pill-level", title: level.title, "aria-label": `Level ${level.level}, ${level.title}. See all levels`, onclick: () => ranksSheet({ ...EMPTY_STATS, ...me, user_id: state.user.id }) }, "Lv ", String(level.level)))),
    h("main", null, (views[state.tab] || nowView)()),
    h("nav", { class: "tabs", "aria-label": "Sections" }, tab("now", "⏱️", "Now"), tab("board", "🏆", "Board"), tab("chat", "💬", "Chat"), tab("me", state.me.emoji, "Me")));
  tick();
  const chatting = state.tab === "chat" && Boolean(chatCrew());
  composer.hidden = !chatting;
  document.documentElement.classList.toggle("chatting", chatting);
  if (chatting) {
    if (followChat) scrollTo({ top: document.documentElement.scrollHeight, behavior: state.chat.jump ? "instant" : "smooth" });
    state.chat.jump = false;
    markChatRead();
  }
  askIfStillThere();
}

function nowView() {
  const others = state.people.filter((p) => p.live_started_at && p.user_id !== state.user.id)
    .sort((a, b) => +new Date(a.live_started_at) - +new Date(b.live_started_at));
  const me = byId(state.user.id);
  const crewToday = state.people.reduce((sum, p) => sum + p.today_minutes, 0);
  // Whoever you're sitting with comes first.
  const groups = studyGroups(others, groupOf).sort((a, b) => withMe(b) - withMe(a));
  return [
    state.live ? runningCard() : state.paused ? pausedCard() : startCard(),
    h("section", { class: "section" },
      h("div", { class: "section-head" }, h("h2", null, "Locked in right now"), h("small", null, [others.length ? `${others.length} studying` : "", state.breaks.length ? `${state.breaks.length} on a break` : ""].filter(Boolean).join(" · "))),
      others.length || state.breaks.length
        ? [...groups.map(liveGroup), ...state.breaks.map(breakCard)]
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
  const mates = matesOf(state.user.id, live.study_group);
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
    mates.length ? h("p", { class: "running-where" }, `👯 With ${listNames(mates.map((p) => p.name))} · `, h("button", { class: "link", onclick: () => leaveGroup() }, "Leave")) : null,
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

const groupOf = (p) => state.liveRows.get(p.user_id)?.study_group || null;
/** Whether this group of people on the Now page is the one you're in. */
const withMe = (people) => Boolean(state.live?.study_group) && groupOf(people[0]) === state.live.study_group;
/** Who's studying in that group, besides this person. */
const matesOf = (userId, group) => (group ? state.people.filter((p) => p.user_id !== userId && p.live_started_at && groupOf(p) === group) : []);

async function sendPing(people, kind) {
  const sent = await Promise.all(people.map((p) => db.from("pings").insert({ to_user: p.user_id, kind })));
  const failed = sent.find((result) => result.error);
  if (failed) return oops(failed.error);
  const names = listNames(people.map((p) => p.name));
  toast(kind === "joining" ? `Told ${names} you're coming 🏃` : `Sent ${names} some fire 🔥`);
}

/** Their name, clock and module; `place` if it should be shown here. */
const liveWho = (p, place) => personButton(p, "live-person",
  avatar(p, "is-live"),
  h("div", { class: "live-who" },
    nameIn(p, "strong"), gemOf(p), " ", sittingClock({ started_at: p.live_started_at, banked_seconds: state.liveRows.get(p.user_id)?.banked_seconds }, "live-clock"),
    h("p", null, p.live_subject, place ? ` · 📍 ${place}` : "")));

function liveCard(p) {
  return h("article", { class: "card live-card" },
    liveWho(p, p.live_location),
    playingLine(state.liveRows.get(p.user_id)?.now_playing),
    state.watching ? null : h("div", { class: "live-actions" },
      h("button", { class: "btn btn-small btn-live", onclick: () => joinSheet([p]) }, "👯 Join"),
      p.live_location ? h("button", { class: "btn btn-small btn-soft", onclick: () => sendPing([p], "joining") }, "🏃 I'm coming") : null,
      h("button", { class: "btn btn-small btn-soft", onclick: () => sendPing([p], "cheer") }, "🔥 Hype")));
}

/** Someone on their own, or everyone sitting together under one heading. */
function liveGroup(people) {
  const mine = withMe(people);
  if (people.length === 1 && !mine) return liveCard(people[0]);
  const place = people.find((p) => p.live_location)?.live_location;
  return h("article", { class: "card group-card" },
    h("p", { class: "group-head" }, `👯 ${mine ? "With you" : "Studying together"}`, place ? ` · 📍 ${place}` : ""),
    people.map((p) => h("div", { class: "group-member" },
      // Someone who's since moved says so.
      liveWho(p, p.live_location !== place ? p.live_location : null),
      state.watching ? null : h("button", { class: "btn btn-small btn-soft", "aria-label": `Hype ${p.name}`, onclick: () => sendPing([p], "cheer") }, "🔥"),
      playingLine(state.liveRows.get(p.user_id)?.now_playing))),
    state.watching || mine ? null : h("div", { class: "live-actions" },
      h("button", { class: "btn btn-small btn-live", onclick: () => joinSheet(people) }, "👯 Join them"),
      place ? h("button", { class: "btn btn-small btn-soft", onclick: () => sendPing(people, "joining") }, "🏃 I'm coming") : null));
}

function breakCard(row) {
  const p = byId(row.user_id);
  return h("article", { class: "card live-card break-card" },
    personButton(p, "live-person",
      avatar(p),
      h("div", { class: "live-who" },
        nameIn(p, "strong"), gemOf(p), " ", h("span", { class: "break-clock" }, "☕ ", h("span", { dataset: { since: row.paused_at } }, clock(Date.now() - +new Date(row.paused_at)))),
        h("p", null, `On a break from ${row.paused_subject} · ${hm(row.banked_seconds / 60)} so far`))));
}

/* ------------------------------------------------------------
   Crew chat — one conversation per crew, only its members see it
   (the database decides). The box you type in sits outside #app, so
   live updates repainting the page never take what you're typing
   or close the keyboard.
   ------------------------------------------------------------ */

/** The crew whose chat is open: the one you last picked, or your first. */
const chatCrew = () => state.crews.find((c) => c.id === readStored(CHAT_CREW_KEY)) || state.crews[0] || null;

function chatReadMarks() { try { return JSON.parse(readStored(CHAT_READ_KEY) || "{}"); } catch (_) { return {}; } }

/** Messages from other people since you last looked, per crew. */
function unreadIn(crewId, marks = chatReadMarks()) {
  const seen = +new Date(marks[crewId] || 0);
  return state.recent.filter((m) => m.crew_id === crewId && m.user_id !== state.user.id && +new Date(m.created_at) > seen).length;
}
const unreadTotal = () => { const marks = chatReadMarks(); return state.crews.reduce((sum, c) => sum + unreadIn(c.id, marks), 0); };

/** Reading the open chat on screen marks it read, up to its newest message. */
function markChatRead() {
  const crew = chatCrew();
  const newest = Math.max(0, ...[...state.chat.messages, ...state.recent].filter((m) => m.crew_id === crew?.id).map((m) => +new Date(m.created_at)));
  if (!crew || !newest || document.hidden) return;
  const marks = chatReadMarks();
  if (+new Date(marks[crew.id] || 0) >= newest) return;
  marks[crew.id] = new Date(newest).toISOString();
  store(CHAT_READ_KEY, JSON.stringify(marks));
}

// A message with its reactions (the database only hands over reactions on messages you can read).
let messageColumns = "id, crew_id, user_id, body, badges, created_at, reactions(user_id, kind)";
/** Asks for messages with their reactions. A database that doesn't have reactions yet (PGRST200) is asked again without, so the chat still works. */
async function messagesQuery(run) {
  const result = await run(messageColumns);
  if (result.error?.code !== "PGRST200" || !messageColumns.includes("reactions")) return result;
  messageColumns = "id, crew_id, user_id, body, badges, created_at";
  return run(messageColumns);
}

/** Opens the chat tab on a crew's conversation, loading it if it isn't already. */
async function openChat(crewId = chatCrew()?.id) {
  if (crewId) store(CHAT_CREW_KEY, crewId);
  const fresh = state.chat.crew !== crewId;
  if (fresh) state.chat = { crew: crewId, messages: [], loaded: false };
  state.chat.jump = true;
  render();
  if (!crewId || (!fresh && state.chat.loaded)) return;
  const { data, error } = await messagesQuery((columns) => db.from("messages").select(columns).eq("crew_id", crewId).order("created_at", { ascending: false }).limit(200));
  if (state.chat.crew !== crewId) return;
  if (error) return oops(error, "Couldn't load the chat.");
  state.chat.messages = (data || []).reverse();
  state.chat.loaded = true;
  state.chat.jump = true;
  if (state.tab === "chat") keepFocus(render);
}

/** A message arrived (yours, or live from the crew). */
function gotMessage(m) {
  if (!m?.id || !state.crews.some((c) => c.id === m.crew_id)) return;
  if (!state.recent.some((r) => r.id === m.id)) state.recent = [m, ...state.recent].slice(0, 60);
  const open = state.chat.crew === m.crew_id;
  if (open && !state.chat.messages.some((r) => r.id === m.id)) state.chat.messages.push(m);
  if (m.user_id !== state.user.id && document.hidden && "Notification" in window && Notification.permission === "granted") {
    const who = byId(m.user_id);
    const crew = state.crews.find((c) => c.id === m.crew_id);
    try { new Notification(`${who?.emoji || "💬"} ${who?.name || "Someone"} · ${crew?.name || "your crew"}`, { body: messageText(m), icon: "icon-180.png", tag: `chat:${m.crew_id}` }); } catch (_) {}
  }
  keepFocus(render);
}

/** A badge card that lost a badge because a session was corrected. */
function changedMessage(m) {
  if (!m?.id) return;
  const swap = (list) => list.map((x) => (x.id === m.id ? { ...x, ...m } : x));
  state.chat.messages = swap(state.chat.messages);
  state.recent = swap(state.recent);
  keepFocus(render);
}

function lostMessage(id) {
  if (!id) return;
  const had = state.chat.messages.length + state.recent.length;
  state.chat.messages = state.chat.messages.filter((m) => m.id !== id);
  state.recent = state.recent.filter((m) => m.id !== id);
  if (state.chat.messages.length + state.recent.length !== had) keepFocus(render);
}

async function sendMessage() {
  const crew = chatCrew();
  const body = chatInput.value.trim();
  if (!crew || !body) return;
  chatInput.value = "";
  growChatInput();
  const { data, error } = await messagesQuery((columns) => db.from("messages").insert({ crew_id: crew.id, body }).select(columns).single());
  if (error) { chatInput.value = body; growChatInput(); return oops(error, "That didn't send. Try again?"); }
  state.chat.jump = true;
  gotMessage(data);
}

/** Someone reacted (you, or live from the crew). Only the open conversation shows them. */
function gotReaction(r) {
  const m = r?.message_id && state.chat.messages.find((x) => x.id === r.message_id);
  if (!m || (m.reactions || []).some((x) => x.user_id === r.user_id && x.kind === r.kind)) return;
  m.reactions = [...(m.reactions || []), { user_id: r.user_id, kind: r.kind }];
  if (state.tab === "chat") keepFocus(render);
}

function lostReaction(r) {
  const m = r?.message_id && state.chat.messages.find((x) => x.id === r.message_id);
  if (!m?.reactions?.some((x) => x.user_id === r.user_id && x.kind === r.kind)) return;
  m.reactions = m.reactions.filter((x) => !(x.user_id === r.user_id && x.kind === r.kind));
  if (state.tab === "chat") keepFocus(render);
}

/** Adds your reaction to a message, or takes it back if it's already there. */
async function react(m, kind) {
  const mine = { message_id: m.id, user_id: state.user.id, kind };
  const had = (m.reactions || []).some((x) => x.user_id === mine.user_id && x.kind === kind);
  const { error } = had
    ? await db.from("reactions").delete().eq("message_id", m.id).eq("user_id", mine.user_id).eq("kind", kind)
    : await db.from("reactions").insert({ message_id: m.id, kind });
  // 23505: it's there already, from another device.
  if (error && error.code !== "23505") return oops(error);
  (had ? lostReaction : gotReaction)(mine);
}

/** The reactions under a message: tap one to add yours or take it back. */
function reactionRow(m) {
  const chips = reactionChips(m.reactions, state.user.id);
  if (!chips.length) return null;
  return h("div", { class: "reacts" }, chips.map((chip) => h("button", { type: "button", class: "react-chip", "aria-pressed": String(chip.mine),
    "aria-label": `${chip.emoji} from ${listNames(chip.who.map((id) => (id === state.user.id ? "you" : nameOf(id))))}`, onclick: (ev) => { ev.stopPropagation(); react(m, chip.kind); } },
    chip.emoji, h("b", null, String(chip.count)))));
}

/** Tap a message: react to it, see who has, or delete it if it's yours. */
function messageSheet(m) {
  const mine = m.user_id === state.user.id;
  const chips = reactionChips(m.reactions, state.user.id);
  sheet((box, close) => box.append(
    h("h2", null, "React"),
    h("div", { class: "react-row", role: "group", "aria-label": "React to this message" }, REACTIONS.map(([kind, emoji]) =>
      h("button", { type: "button", class: "react-pick", "aria-pressed": String(chips.some((chip) => chip.kind === kind && chip.mine)), "aria-label": kind, onclick: () => { close(); react(m, kind); } }, emoji))),
    chips.length ? h("div", { class: "react-who" }, chips.map((chip) => h("p", null, h("span", { "aria-hidden": "true" }, chip.emoji), " ", listNames(chip.who.map((id) => (id === state.user.id ? "You" : nameOf(id))))))) : null,
    h("div", { class: "btn-row" },
      mine ? h("button", { class: "btn btn-soft", style: { color: "var(--danger)" }, onclick: () => { close(); deleteMessage(m); } }, "Delete") : null,
      h("button", { class: "btn btn-soft", onclick: close }, "Close"))), { key: `message:${m.id}` });
}

async function deleteMessage(m) {
  if (!confirm("Delete this message for everyone?")) return;
  const { error } = await db.from("messages").delete().eq("id", m.id);
  if (error) return oops(error);
  lostMessage(m.id);
}

/** The badges a message announces, in the app's order. A secret one stays a secret. */
const newsBadges = (m) => BADGES.filter((badge) => m.badges?.includes(badge.id));
const badgeLabel = (badge) => (badge.secret ? "❓ a secret badge 🤫" : `${badge.icon} ${badge.name}`);

/** A message as plain text, for a notification. */
function messageText(m) {
  if (!m.badges?.length) return m.body;
  const won = newsBadges(m);
  return won.length === 1 ? `earned ${badgeLabel(won[0])}` : `earned ${won.length} badges: ${won.map(badgeLabel).join(", ")}`;
}

/** "Leonardo earned 👻 3am Club": the database posts these when someone earns badges. Tap to react; yours you can delete. */
function badgeNews(m) {
  const who = byId(m.user_id);
  const mine = m.user_id === state.user.id;
  const won = newsBadges(m);
  return h("div", { class: "chat-news-wrap" },
    h("button", { type: "button", class: "chat-news", title: "React", onclick: () => messageSheet(m) },
      h("span", { class: "chat-news-badge", "aria-hidden": "true" }, won.length === 1 ? (won[0].secret ? "❓" : won[0].icon) : "🏅"),
      h("div", null,
        h("p", null, h("strong", null, `${who?.emoji || ""} ${mine ? "You" : who?.name || "Someone who left"}`.trim()),
          won.length === 1 ? ` earned ${won[0].secret ? "a secret badge 🤫" : won[0].name}` : ` earned ${won.length || "a"} ${won.length === 1 ? "badge" : "badges"}`),
        h("small", null, won.length === 1 ? (won[0].secret ? "What could it be?" : won[0].detail) : won.map(badgeLabel).join(" · ")),
        h("time", { datetime: m.created_at }, timeOf(m.created_at)))),
    reactionRow(m));
}

/** Links in a message, and only http(s) ones, become tappable; everything else stays plain text. */
const linkify = (text) => text.split(/(https?:\/\/[^\s<]*[^\s<.,:;"')\]!?])/g).map((part, i) => i % 2 ? h("a", { href: part, target: "_blank", rel: "noopener noreferrer" }, part) : part);

function dayHeading(iso) {
  const day = ukDay(new Date(iso));
  if (day === ukDay(new Date())) return "Today";
  if (day === ukDay(dayStart(new Date(), -1))) return "Yesterday";
  return new Date(iso).toLocaleDateString("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });
}

function chatView() {
  const crew = chatCrew();
  if (!crew) return h("div", { class: "card empty" }, h("span", { class: "big" }, "💬"), "Join a crew to chat with it.");
  if (state.chat.crew !== crew.id) { queueMicrotask(() => openChat(crew.id)); }
  const marks = chatReadMarks();
  const picker = state.crews.length > 1
    ? h("div", { class: "chips chat-crews", role: "group", "aria-label": "Your crews' chats" }, state.crews.map((c) => {
      const n = c.id === crew.id ? 0 : unreadIn(c.id, marks);
      return h("button", { type: "button", class: "chip", "aria-pressed": String(c.id === crew.id), onclick: () => openChat(c.id) }, c.name, n ? h("b", { class: "chip-count" }, n > 9 ? "9+" : String(n)) : null);
    }))
    : null;
  const lines = [];
  let lastDay = null, lastSender = null, lastAt = 0;
  for (const m of state.chat.messages) {
    const day = ukDay(new Date(m.created_at));
    if (day !== lastDay) { lines.push(h("p", { class: "chat-day" }, dayHeading(m.created_at))); lastSender = null; }
    if (m.badges?.length) { lines.push(badgeNews(m)); lastDay = day; lastSender = null; continue; }
    // Messages from the same person within a few minutes sit together under one name.
    const together = lastSender === m.user_id && +new Date(m.created_at) - lastAt < 5 * 60000;
    const mine = m.user_id === state.user.id;
    const who = byId(m.user_id);
    lines.push(h("div", { class: `msg${mine ? " is-mine" : ""}${together ? " is-cont" : ""}` },
      mine ? null : h("span", { class: `msg-avatar${together ? " is-blank" : ""}`, "aria-hidden": "true" }, who?.emoji || "👤"),
      h("div", { class: "msg-col" },
        // Tap a message to react to it (a link in it still opens).
        h("div", { class: "msg-bubble", role: "button", tabindex: "0", "aria-label": `${mine ? "Your message" : `Message from ${who?.name || "someone who left"}`}. React`,
          onclick: (ev) => { if (!ev.target.closest("a")) messageSheet(m); },
          onkeydown: (ev) => { if ((ev.key === "Enter" || ev.key === " ") && ev.target === ev.currentTarget) { ev.preventDefault(); messageSheet(m); } } },
          mine || together ? null : (who ? h("strong", null, nameIn(who), gemOf(who)) : h("strong", null, "Someone who left")),
          h("p", null, ...linkify(m.body)),
          h("time", { datetime: m.created_at }, timeOf(m.created_at))),
        reactionRow(m))));
    lastDay = day; lastSender = m.user_id; lastAt = +new Date(m.created_at);
  }
  return [
    h("div", { class: "section-head" }, h("h2", null, crew.name), h("small", null, `${crew.members} ${crew.members === 1 ? "member" : "members"} · only you lot see this`)),
    picker,
    h("section", { class: "chat", "aria-label": `${crew.name} chat`, "aria-live": "polite" },
      lines.length ? lines : h("div", { class: "card empty" }, h("span", { class: "big" }, state.chat.loaded ? "👋" : "⏳"), state.chat.loaded ? "No messages yet. Say hi to the crew." : "Loading the chat…")),
  ];
}

/** Where you type. One for the whole app, outside #app, so a repaint never replaces it. */
const chatInput = h("textarea", { id: "chat-input", class: "composer-input", rows: 1, maxlength: 1000, placeholder: "Message the crew", "aria-label": "Message",
  enterkeyhint: matchMedia("(hover: hover)").matches ? "send" : "enter",
  oninput: () => growChatInput(),
  // A keyboard with a mouse: Enter sends, Shift+Enter is a new line. On a phone, the button sends.
  onkeydown: (ev) => { if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing && matchMedia("(hover: hover)").matches) { ev.preventDefault(); sendMessage(); } },
  onfocus: () => setTimeout(() => scrollTo({ top: document.documentElement.scrollHeight }), 300) });
function growChatInput() { chatInput.style.height = "auto"; chatInput.style.height = `${Math.min(chatInput.scrollHeight, 132)}px`; }
const composer = h("form", { class: "composer", hidden: true, onsubmit: (ev) => { ev.preventDefault(); sendMessage(); chatInput.focus({ preventScroll: true }); } },
  chatInput, h("button", { class: "btn composer-send", type: "submit", "aria-label": "Send" }, "➤"));
document.body.append(composer);

const BOARDS = { today: { label: "Today", key: "today_minutes", period: "day", total: "today" }, week: { label: "This week", key: "week_minutes", period: "week", total: "this week" }, all: { label: "All time", key: "total_minutes" },
  // The ranked board: everyone's average week, which is what their tier comes from.
  ranked: { label: "Ranked", key: "ranked_minutes", ranked: true } };

function boardView() {
  const board = BOARDS[state.board] || BOARDS.week;
  const key = board.key;
  const ranked = standings(state.people, key);
  const crewTotal = ranked.reduce((sum, p) => sum + p[key], 0);
  // An empty day is an open race, not a tie between everybody.
  const who = state.watching && byId(state.user.id)?.name;
  const chase = board.ranked ? null : crewTotal ? chaseLine(ranked, state.user.id, key, who) : board.period === "day" ? `Nobody's on the board today yet.${who ? "" : " Lock in to take first."}` : null;
  // The ranked board shows an average week, not a total.
  const time = (minutes) => (board.ranked ? `${weekHours(minutes)}/wk` : hm(minutes));
  const leader = Math.max(1, ...ranked.map((p) => p[key]));
  const spot = (p, place) => p
    ? personButton(p, `podium-spot ${place}`, avatar(p, p.live_started_at ? "is-live" : ""), h("span", { class: "podium-name" }, nameIn(p)), h("span", { class: "podium-time" }, time(p[key])),
      h("div", { class: "podium-block" }, place === "first" ? "1" : place === "second" ? "2" : "3"))
    : h("div", { class: `podium-spot ${place} empty-spot` }, h("span", { class: "avatar" }, "?"), h("span", { class: "podium-name" }, "—"), h("div", { class: "podium-block" }));
  return [
    h("section", { class: "card" },
      h("div", { class: "board-head" },
        h("div", { class: "toggle", role: "group", "aria-label": "Period" },
          ...Object.entries(BOARDS).map(([k, b]) => h("button", { "aria-pressed": String(board === b), onclick: () => { state.board = k; store(BOARD_KEY, k); repaint(); } }, b.label))),
        h("span", { class: "reset" }, board.ranked ? `${RANKED_WEEKS}-week average` : board.period ? `Resets in ${untilReset(new Date(), board.period)}` : `${hm(crewTotal)} together`)),
      h("div", { class: "podium" }, spot(ranked[1], "second"), spot(ranked[0], "first"), spot(ranked[2], "third")),
      chase ? h("div", { class: "chase" }, h("span", { "aria-hidden": "true" }, "🎯"), h("span", null, chase)) : null,
      h("ol", { class: "ranks" }, ranked.map((p) => h("li", null, personButton(p, `rank-row${p.user_id === state.user.id ? " is-me" : ""}`,
        h("span", { class: "rank-num" }, String(p.rank)),
        avatar(p, p.live_started_at ? "is-live" : ""),
        h("div", { class: "rank-main" },
          h("strong", null, nameIn(p), gemOf(p), p.live_started_at ? h("i", { class: "live-dot", title: "Locked in now" }) : null, p.streak ? h("em", { class: "flame" }, `🔥${p.streak}`) : null),
          h("div", { class: "rank-bar" }, h("span", { style: { width: `${Math.max(3, (p[key] / leader) * 100)}%` } }))),
        h("span", { class: "rank-time" }, time(p[key]))))))),
    board.total ? h("p", { class: "small muted", style: { textAlign: "center", margin: "12px 0 0" } }, `Crew total ${board.total}: ${hm(crewTotal)}`) : null,
    board.ranked ? h("p", { class: "small muted", style: { textAlign: "center", margin: "12px 8px 0" } }, `Average hours a week over the last ${RANKED_WEEKS} weeks. It sets your tier, and it moves both ways.`) : null,
    h("section", { class: "section" },
      h("div", { class: "section-head" }, h("h2", null, "Recent sessions")),
      h("div", { class: "card" }, state.feed.length ? state.feed.map((s) => {
        const p = byId(s.user_id);
        return (p ? (...kids) => personButton(p, "feed-row", ...kids) : (...kids) => h("div", { class: "feed-row" }, ...kids))(p ? avatar(p) : h("span", { class: "avatar", "aria-hidden": "true" }, "📚"),
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
        : h("p", { class: "empty" }, "No modules yet. Add the ones you study. Your crew sees your time on each."),
      archived.length ? h("p", { class: "small muted", style: { marginTop: "12px" } }, "Archived: ", archived.map((m, i) => [i ? ", " : "", h("button", { class: "link", style: { padding: "0" }, title: `Bring ${m.name} back`, onclick: () => archiveModule(m, false) }, m.name)])) : null));
}

/* ------------------------------------------------------------
   Profiles: yours in Me, a crewmate's in a sheet
   ------------------------------------------------------------ */

function heroCard(person) {
  const streak = streakFrom(person.days);
  const level = levelProgress(person.total_minutes);
  const rank = standings(state.people, "week_minutes").find((p) => p.user_id === person.user_id)?.rank;
  const ranked = rankedOf(person);
  const flair = flairOf(person.user_id);
  const tag = shopItem(flair.tag);
  const you = person.user_id === state.user.id && !state.watching;
  const treats = SHOP.filter((x) => x.kind === "treat" && flair.treats?.[x.id]);
  return h("section", { class: "card hero" },
    // The banner is their tier: it changes as their average week does.
    h("button", { type: "button", class: "hero-banner", dataset: { tier: ranked.tier?.id || "none" }, "aria-label": `${ranked.tier ? `${ranked.tier.name} tier, ${weekHours(ranked.average)} a week` : "Unranked"}. See Ranked`, onclick: () => rankedSheet(person) },
      h("span", { class: "hero-banner-tier" }, gem(ranked.tier, "gem-big"), ranked.tier ? ranked.tier.name : "Unranked"),
      h("span", { class: "hero-banner-rate" }, ranked.tier ? `${weekHours(ranked.average)} a week` : "Study to get placed", h("span", { "aria-hidden": "true" }, " ›"))),
    avatar(person, `avatar-big${person.live_started_at ? " is-live" : ""}`),
    nameIn(person, "h2"),
    tag ? h("p", { class: "hero-tag" }, `${tag.icon} ${tag.name}`) : null,
    h("button", { type: "button", class: "hero-title", "aria-label": `Level ${level.level}, ${level.title}. See all levels`, onclick: () => ranksSheet(person) }, `Level ${level.level} · ${level.title}`, h("span", { "aria-hidden": "true" }, " ›")),
    person.live_started_at ? h("p", { class: "hero-live" }, "🔒 Locked in on ", h("b", null, person.live_subject), person.live_location ? ` at ${person.live_location}` : "") : null,
    h("div", { class: "xp" },
      h("div", { class: "xp-top" }, h("span", null, `${Math.round(person.total_minutes)} XP`), h("span", null, `${hm(level.toNext)} to Level ${level.level + 1}`)),
      h("div", { class: "xp-bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(Math.round(level.ratio * 100)) }, h("span", { style: { width: `${Math.max(2, level.ratio * 100)}%` } }))),
    h("div", { class: "hero-stats" },
      h("div", null, h("strong", null, hm(person.week_minutes)), h("span", null, rank && state.people.length > 1 ? `This week · #${rank}` : "This week")),
      h("div", null, h("strong", null, `🔥 ${streak}`), h("span", null, "Day streak")),
      h("div", null, h("strong", null, hm(person.total_minutes)), h("span", null, "All time"))),
    treats.length ? h("div", { class: "treats", role: "group", "aria-label": "Gifts from the crew" },
      h("span", { class: "label" }, "Gifts"),
      treats.map((t) => h("span", { class: "treat", title: t.name, "aria-label": `${t.name} × ${flair.treats[t.id]}` }, t.icon, flair.treats[t.id] > 1 ? h("b", null, `×${flair.treats[t.id]}`) : null))) : null,
    you ? h("div", { class: "hero-shop" },
      h("div", null, h("strong", null, `🪙 ${Math.max(0, state.wallet.coins)} coins`), h("small", null, `${COINS_PER_HOUR} for every hour you study`)),
      h("button", { class: "btn btn-small btn-gold", onclick: () => shopSheet() }, "Shop")) : null,
    !you && !state.watching ? h("button", { class: "btn btn-small btn-soft hero-gift", onclick: () => giftSheet(person) }, "🎁 Send a gift") : null);
}

/* ------------------------------------------------------------
   Ranked: a tier that follows your average week (rankedFor). The
   level ladder only climbs; this one moves both ways.
   ------------------------------------------------------------ */

/** Every tier, the top one first, and where someone stands. It opens on where they are now. */
function rankedSheet(person) {
  hideTip();
  const you = person.user_id === state.user.id && !state.watching;
  const r = rankedOf(person);
  let here = null;
  const row = (tier) => {
    const status = !r.tier || tier.index > r.tier.index ? "ahead" : tier.index === r.tier.index ? "current" : "passed";
    const current = status === "current";
    const node = h("li", { class: `rung is-${status}`, "aria-current": current ? "step" : null },
      h("span", { class: "rung-icon", "aria-hidden": "true" }, gem(tier, "gem-big")),
      h("div", null,
        current ? h("span", { class: "label rung-here" }, you ? "You're here" : `${person.name} is here`) : null,
        h("strong", null, tier.name),
        h("small", null, current
          ? (r.next ? `${hm(r.toNext)} more study to reach ${r.next.name}` : "The top tier")
          : tier.hours ? `${tier.hours}h+ a week` : `Any study in the last ${RANKED_WEEKS} weeks`),
        current && r.next ? h("div", { class: "xp-bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(Math.round(r.ratio * 100)) }, h("span", { style: { width: `${Math.max(2, r.ratio * 100)}%` } })) : null));
    if (current) here = node;
    return node;
  };
  const over = r.weeks < RANKED_WEEKS ? (r.days === 7 ? "in the first week" : `over the first ${r.days} days`) : `over the last ${RANKED_WEEKS} weeks`;
  const summary = r.tier
    ? `${you ? "You're" : `${person.name} is`} averaging ${weekHours(r.average)} a week ${over}.`
    : `${you ? "You haven't" : `${person.name} hasn't`} studied in the last ${RANKED_WEEKS} weeks. One session gets ${you ? "you" : "them"} placed.`;
  let inner = null;
  sheet((box, close) => {
    inner = box;
    box.append(
      h("div", { class: "sheet-top" }, h("button", { class: "link", onclick: close }, "Close")),
      h("h2", null, "Ranked"),
      h("p", { class: "muted", style: { marginTop: "6px" } }, summary),
      h("p", { class: "small muted", style: { marginTop: "6px" } }, `Your tier follows your average hours a week, so it moves both ways: study more and you're promoted, ease off and you drop. Levels never go down. This does.`),
      h("ol", { class: "ladder", reversed: true }, [...TIERS].reverse().map(row)));
  }, { key: "ranked" });
  if (inner && here) inner.scrollTop += here.getBoundingClientRect().top - inner.getBoundingClientRect().top - (inner.clientHeight - here.offsetHeight) / 2;
}

/** A change of tier since this device last looked. The first time, just say where they've been placed. */
function announceTier() {
  const me = byId(state.user.id);
  if (!me) return;
  const r = rankedOf(me);
  const key = `lockedin.tier.${state.user.id}`;
  const now = r.tier ? r.tier.index : -1;
  const before = readStored(key);
  store(key, String(now));
  if (before === null) {
    if (r.tier) toast(`New: Ranked. Your average week puts you in ${r.tier.name}. Tap your banner in Me to see the tiers.`, { ms: 8000 });
    return;
  }
  const move = tierMove(Number(before), now);
  if (move === "up") {
    confetti(["🎉", "⭐️", "🚀", "✨"]);
    toast(Number(before) < 0 ? `You're placed in ${r.tier.name} 🎉` : `Promoted to ${r.tier.name}! 🎉`, { ms: 7000 });
  } else if (move === "down") {
    toast(r.tier ? `Dropped to ${r.tier.name}. ${hm(r.toNext)} more study gets ${r.next.name} back.` : "You've dropped out of the tiers. One session gets you placed again.", { ms: 7000 });
  }
}

/* ------------------------------------------------------------
   Coins and the shop. The database works out your coins from your
   sessions and checks every purchase (shop_buy, shop_wear); this
   only shows what there is and asks.
   ------------------------------------------------------------ */

async function reloadShop() {
  const [wallet, flair] = await Promise.all([db.rpc("my_wallet"), db.rpc("crew_flair")]);
  if (wallet.data) state.wallet = wallet.data;
  if (flair.data) state.flair = new Map(flair.data.map((row) => [row.user_id, row]));
}

/** How far off something is: "You need 40 more coins, about 4h 00m of study." */
const shortOf = (price) => `You need ${price - Math.max(0, state.wallet.coins)} more coins, about ${hm(((price - Math.max(0, state.wallet.coins)) * 60) / COINS_PER_HOUR)} of study.`;

/** How an item looks on someone: a frame round their emoji, their name in a colour, a tag. */
function itemPreview(item, person) {
  if (item.kind === "frame") return h("span", { class: "avatar", dataset: { frame: item.id }, "aria-hidden": "true" }, person.emoji);
  if (item.kind === "color") return h("strong", { class: "who-name shop-name", dataset: { color: item.id } }, person.name);
  if (item.kind === "tag") return h("span", { class: "hero-tag" }, `${item.icon} ${item.name}`);
  return h("b", { class: "shop-treat", "aria-hidden": "true" }, item.icon);
}

/** Your shop: buy things to wear, put them on, take them off. Gifts start from a friend's profile. */
function shopSheet() {
  const me = { user_id: state.user.id, name: state.me.name, emoji: state.me.emoji };
  let busy = false;
  sheet((box, close) => {
    async function act(work) {
      if (busy) return;
      busy = true;
      try { await work(); } finally { busy = false; }
      if (box.isConnected) paint();
      render();
    }
    const wear = (item, on) => act(async () => {
      const { error } = await db.rpc("shop_wear", { p_slot: item.kind, p_item: on ? item.id : null });
      if (error) return oops(error);
      await reloadShop();
    });
    const buy = (item) => {
      if (state.wallet.coins < item.price) return toast(shortOf(item.price), { bad: true, ms: 5000 });
      if (!confirm(`Buy ${item.name} for ${item.price} coins?`)) return;
      act(async () => {
        const { error } = await db.rpc("shop_buy", { p_item: item.id });
        if (error) return oops(error);
        // Bought to be worn: put it straight on.
        await db.rpc("shop_wear", { p_slot: item.kind, p_item: item.id });
        await reloadShop();
        confetti(["🪙", "✨", "🛍️", "✨"]);
        toast(`${item.name} is yours, and on ✨`);
      });
    };
    function paint() {
      const flair = flairOf(state.user.id);
      const owned = new Set(state.wallet.owned || []);
      const tile = (item) => {
        const wearing = flair[item.kind] === item.id;
        return h("div", { class: `shop-item${wearing ? " is-on" : ""}` },
          h("div", { class: "shop-preview" }, itemPreview(item, me)),
          item.kind === "tag" ? null : h("span", { class: "shop-item-name" }, item.name),
          wearing ? h("button", { type: "button", class: "btn btn-small btn-soft", onclick: () => wear(item, false) }, "Wearing ✓")
            : owned.has(item.id) ? h("button", { type: "button", class: "btn btn-small", onclick: () => wear(item, true) }, "Wear")
              : h("button", { type: "button", class: "btn btn-small btn-gold", "aria-label": `Buy ${item.name} for ${item.price} coins`, onclick: () => buy(item) }, `🪙 ${item.price}`));
      };
      box.replaceChildren(
        h("div", { class: "sheet-top" }, h("button", { class: "link", onclick: close }, "Close")),
        h("div", { class: "shop-head" }, h("h2", null, "Shop"), h("span", { class: "pill coins" }, `🪙 ${Math.max(0, state.wallet.coins)}`)),
        h("p", { class: "muted", style: { marginTop: "6px" } }, `You earn ${COINS_PER_HOUR} coins for every hour you study. Your crew sees what you wear. To give something, open a friend's profile.`),
        ...SHOP_KINDS.filter(([kind]) => kind !== "treat").map(([kind, label]) => h("div", { class: "shop-group" },
          h("h3", null, label),
          h("div", { class: `shop-grid shop-${kind}` }, SHOP.filter((item) => item.kind === kind).map(tile)))));
    }
    paint();
  }, { key: "shop" });
}

/** Send a crewmate a treat, or something to wear. It reaches them like a hype, and treats stay on their profile. */
function giftSheet(person) {
  let busy = false;
  sheet((box, close) => {
    const send = async (item) => {
      if (busy) return;
      if (state.wallet.coins < item.price) return toast(shortOf(item.price), { bad: true, ms: 5000 });
      if (!confirm(`Send ${person.name} ${giftLabel(item.id)} for ${item.price} coins?`)) return;
      busy = true;
      const { data, error } = await db.rpc("shop_buy", { p_item: item.id, p_for: person.user_id });
      busy = false;
      if (error) return oops(error);
      state.wallet = { ...state.wallet, coins: data.coins };
      close();
      confetti(["🎁", item.icon || "✨", "✨"]);
      toast(`Sent ${person.name} ${giftLabel(item.id)} 🎁`);
      refreshSoon();
    };
    const tile = (item) => h("button", { type: "button", class: "shop-item gift-item", "aria-label": `${item.name}, ${item.price} coins`, onclick: () => send(item) },
      h("div", { class: "shop-preview" }, itemPreview(item, person)),
      item.kind === "tag" ? null : h("span", { class: "shop-item-name" }, item.name),
      h("span", { class: "gift-price" }, `🪙 ${item.price}`));
    box.append(
      h("div", { class: "sheet-top" }, h("button", { class: "link", onclick: close }, "Close")),
      h("div", { class: "shop-head" }, h("h2", null, `A gift for ${person.name} 🎁`), h("span", { class: "pill coins" }, `🪙 ${Math.max(0, state.wallet.coins)}`)),
      h("p", { class: "muted", style: { marginTop: "6px" } }, `${person.name} sees it straight away. Treats stay on their profile.`),
      // Treats first: they're what a gift usually is.
      ...[SHOP_KINDS.at(-1), ...SHOP_KINDS.slice(0, -1)].map(([kind, label]) => h("div", { class: "shop-group" },
        h("h3", null, kind === "treat" ? label : `${label}, for them to wear`),
        h("div", { class: `shop-grid shop-${kind}` }, SHOP.filter((item) => item.kind === kind).map(tile)))));
  }, { key: `gift:${person.user_id}` });
}

/** Every rank, the top one first, and how far up someone has climbed. It opens on where they are now. */
function ranksSheet(person) {
  hideTip();
  const you = person.user_id === state.user.id && !state.watching;
  const level = levelProgress(person.total_minutes);
  const ranks = ranksFor(person.total_minutes);
  const top = ranks.at(-1);
  const next = ranks.find((rank) => rank.status === "ahead");
  let here = null;
  const row = (rank) => {
    const at = rank.minutes ? `${(rank.minutes / 60).toLocaleString("en-GB")}h` : null;
    const current = rank.status === "current";
    const node = h("li", { class: `rung is-${rank.status}`, "aria-current": current ? "step" : null },
      h("span", { class: "rung-icon", "aria-hidden": "true" }, h("span", null, rank.icon)),
      h("div", null,
        current ? h("span", { class: "label rung-here" }, you ? "You're here" : `${person.name} is here`) : null,
        h("strong", null, `Level ${current ? level.level : rank.level} · ${rank.title}`),
        h("small", null, current
          ? `${hm(level.toNext)} to ${next ? next.title : `Level ${level.level + 1}`}`
          : [rank === top ? "The top" : null, at, rank.status === "passed" ? "Reached ✓" : `${hm(rank.left)} to go`].filter(Boolean).join(" · ")),
        current ? h("div", { class: "xp-bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(Math.round(level.ratio * 100)) }, h("span", { style: { width: `${Math.max(2, level.ratio * 100)}%` } })) : null));
    if (current) here = node;
    return node;
  };
  const summary = top.status === "current"
    ? `${you ? "You've" : `${person.name} has`} reached the top ${top.icon}`
    : `${you ? "You're" : `${person.name} is`} ${hm(top.left)} away from ${top.title} ${top.icon}`;
  let inner = null;
  sheet((box, close) => {
    inner = box;
    box.append(
      h("div", { class: "sheet-top" }, h("button", { class: "link", onclick: close }, "Close")),
      h("h2", null, "Levels"),
      h("p", { class: "muted", style: { marginTop: "6px" } }, summary),
      h("ol", { class: "ladder", reversed: true }, [...ranks].reverse().map(row)));
  }, { key: "ranks" });
  if (inner && here) inner.scrollTop += here.getBoundingClientRect().top - inner.getBoundingClientRect().top - (inner.clientHeight - here.offsetHeight) / 2;
}

/** What's left for a badge: "1h 20m to go", "4 more days". */
function badgeToGo(badge) {
  const left = badge.goal - badge.value;
  if (badge.unit === "time") return `${hm(left)} to go`;
  return `${left} more${badge.unit === "days" ? (left === 1 ? " day" : " days") : ""}`;
}

/** Someone's badges, grouped, with how far along the locked ones are and who else in the crew has each. */
function badgesSection(person) {
  const facts = state.badgeFacts.get(person.user_id);
  if (!facts) return h("section", { class: "section" }, h("div", { class: "section-head" }, h("h2", null, "Badges")), h("div", { class: "card empty" }, "Badges show up once the crew's loaded."));
  const badges = badgesFor(facts);
  const streak = streakFrom(person.days);
  const mine = person.user_id === state.user.id;
  // On a watch page the person is the one who shared it, so it's their name, not "you".
  const you = mine && !state.watching;
  const crew = [...state.badgeFacts].filter(([id]) => byId(id)).map(([, f]) => f);
  const holders = (badge) => crew.filter((f) => (Number(f[badge.key]) || 0) >= badge.goal).length;
  const tile = (badge) => {
    const hidden = badge.secret && !badge.got;
    const progress = badgeProgress(badge);
    const have = holders(badge);
    // Earned, and nobody else in a crew of three or more has it.
    const rare = badge.got && have === 1 && crew.length >= 3;
    const node = h("button", { type: "button", class: `badge ${badge.got ? "got" : "locked"}`, "aria-label": hidden ? "Secret badge" : `${badge.name}: ${badge.detail}${badge.got ? ", earned" : progress ? `, ${progress}` : ""}` },
      rare ? h("i", { class: "badge-rare" }, you ? "Only you" : `Only ${person.name}`) : null,
      h("b", { "aria-hidden": "true" }, hidden ? "❓" : badge.icon),
      h("strong", null, hidden ? "???" : badge.name),
      h("small", null, hidden ? badge.hint : badge.detail),
      progress ? h("span", { class: "badge-bar", "aria-hidden": "true" }, h("span", { style: { width: `${Math.max(4, badge.ratio * 100)}%` } })) : null,
      progress ? h("em", null, progress) : null);
    explain(node, () => [
      hidden ? "❓ Secret badge" : `${badge.icon} ${badge.name}`,
      hidden ? badge.hint : badge.detail,
      badge.got ? (you ? "You've got it 🏅" : `${person.name} has it 🏅`) : progress ? `${progress} · ${addsUp(badge, streak) ? badgeToGo(badge) : "best so far"}` : "Not yet",
      have ? `${have} of ${crew.length} in the crew ${have === 1 ? "has" : "have"} it` : "Nobody in the crew has it yet",
    ]);
    return node;
  };
  const next = mine ? nextBadges(badges, streak) : [];
  return h("section", { class: "section" },
    h("div", { class: "section-head" }, h("h2", null, "Badges"), h("small", null, `${badges.filter((x) => x.got).length} of ${badges.length}`)),
    next.length ? h("div", { class: "card next-badges" },
      h("span", { class: "label" }, "Next up"),
      next.map((badge) => h("div", { class: "next-badge" },
        h("b", { "aria-hidden": "true" }, badge.icon),
        h("div", null, h("strong", null, badge.name), h("small", null, `${badge.detail} · ${badgeToGo(badge)}`),
          h("span", { class: "badge-bar", "aria-hidden": "true" }, h("span", { style: { width: `${Math.max(4, badge.ratio * 100)}%` } })))))) : null,
    BADGE_GROUPS.map(([key, label, note]) => {
      const group = badges.filter((x) => x.group === key);
      return h("div", { class: "badge-group" },
        h("div", { class: "badge-group-head" }, h("h3", null, label), h("small", null, `${group.filter((x) => x.got).length}/${group.length}`)),
        note ? h("p", { class: "small muted" }, note) : null,
        h("div", { class: "badges" }, group.map(tile)));
    }));
}

/** New badges since this device last looked: one cheer for them. The first time, just say how many are waiting. */
function announceBadges() {
  const facts = state.badgeFacts.get(state.user.id);
  if (!facts) return;
  const key = `lockedin.badges.${state.user.id}`;
  const earned = badgesFor(facts).filter((badge) => badge.got);
  let seen = null;
  try { seen = JSON.parse(readStored(key) || "null"); } catch (_) {}
  store(key, JSON.stringify(earned.map((badge) => badge.id)));
  if (!Array.isArray(seen)) {
    if (earned.length) toast(`🏅 You've unlocked ${earned.length} ${earned.length === 1 ? "badge" : "badges"} already. See them in Me.`, { ms: 6000 });
    return;
  }
  const fresh = earned.filter((badge) => !seen.includes(badge.id));
  if (!fresh.length) return;
  confetti(["🏅", ...fresh.map((badge) => badge.icon), "✨"]);
  toast(fresh.length === 1 ? `🏅 New badge: ${fresh[0].icon} ${fresh[0].name}!` : `🏅 ${fresh.length} new badges: ${fresh.slice(0, 3).map((badge) => `${badge.icon} ${badge.name}`).join(", ")}`, { ms: 7000 });
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
    Promise.all([
      db.from("sessions").select("subject, started_at, ended_at, location")
        .eq("user_id", userId).gte("started_at", new Date(Date.now() - 70 * 86400000).toISOString()).order("started_at", { ascending: false }).limit(400),
      db.rpc("crew_module_split", { p_user: userId, p_tz: TZ }),
    ]).then(([{ data: sessions, error }, split]) => {
      if (!box.isConnected) return;
      if (error) return pending.replaceChildren("Couldn't load their activity. Close and try again.");
      pending.replaceWith(activityCard(person, sessions || [], "Activity"), moduleSplit(split.data || [], person.name));
      badges.after(recentSessions(sessions || [], person.name));
    });
  }, { key: `profile:${userId}` });
}

/** Someone's time per module (crew_module_split): one bar for the whole split, then this week and all time for each. */
function moduleSplit(modules, name) {
  const total = modules.reduce((sum, m) => sum + m.total_minutes, 0);
  // Each module in the colour its owner gave it; one that's since been renamed or removed borrows a slot.
  const colour = (m, i) => `var(--m${m.color ?? i % 8})`;
  const share = (m) => Math.round((m.total_minutes / total) * 100);
  const bar = h("div", { class: "split-bar", role: "img", "aria-label": modules.map((m) => `${m.name} ${share(m)}%`).join(", ") },
    modules.map((m, i) => {
      const part = h("span", { style: { flexGrow: String(m.total_minutes), background: colour(m, i) } });
      explain(part, () => [m.name, `${hm(m.total_minutes)} all time · ${share(m)}%`, `${hm(m.week_minutes)} this week`]);
      return part;
    }));
  return h("section", { class: "section" },
    h("div", { class: "section-head" }, h("h2", null, "Modules"), total ? h("small", null, `${hm(total)} all time`) : null),
    h("div", { class: "card" }, modules.length
      ? [bar, modules.map((m, i) => h("div", { class: "module-row" },
        h("div", { class: "module-main" },
          h("strong", null, h("i", { class: "module-dot", style: { background: colour(m, i) }, "aria-hidden": "true" }), h("span", null, m.name)),
          h("small", null, `${hm(m.week_minutes)} this week · ${hm(m.total_minutes)} all time`)),
        h("strong", { class: "split-share" }, `${share(m)}%`)))]
      : h("p", { class: "empty" }, `${name} hasn't logged any time yet.`)));
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
      canNotify ? h("div", { class: "setting" }, h("div", null, h("strong", null, "Notifications"), h("small", null, Notification.permission === "granted" ? "On while Locked In is open" : "When a friend locks in, pings you or messages the crew")),
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
  state.watchToken = token;
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
  state.people = data.people.map(withRanked);
  state.flair = new Map((data.flair || []).map((row) => [row.user_id, row]));
  state.liveRows = new Map(data.live.map((row) => [row.user_id, row]));
  state.breaks = data.live.filter((row) => !row.started_at && row.paused_at && byId(row.user_id));
  state.feed = data.feed;
  state.badgeFacts = new Map((data.badges || []).map((row) => [row.user_id, row.facts]));
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
function watchPerson(who, { sessions, modules }) {
  const row = state.liveRows.get(who.user_id);
  const mates = matesOf(who.user_id, row?.study_group);
  const last = sessions[0];
  const today = `Today: ${who.today_minutes ? hm(who.today_minutes) : "nothing yet"}`;
  const status = who.live_started_at
    ? h("section", { class: "card running" },
      h("span", { class: "running-tag" }, "STUDYING NOW"),
      h("h2", null, who.live_subject),
      sittingClock({ started_at: who.live_started_at, banked_seconds: row?.banked_seconds }, "big-clock"),
      who.live_location ? h("p", { class: "running-where" }, "📍 ", who.live_location) : null,
      mates.length ? h("p", { class: "running-where" }, `👯 With ${listNames(mates.map((p) => p.name))}`) : null,
      playingLine(row?.now_playing),
      h("p", { class: "running-where" }, today))
    : h("section", { class: `card watch-status${row?.paused_at ? " is-break" : ""}` },
      h("strong", null, row?.paused_at ? `☕ On a break since ${timeOf(row.paused_at)}` : "Not studying right now"),
      h("p", null, today),
      !row?.paused_at && last ? h("small", null, `Last: ${last.subject}, ${new Date(last.ended_at).toLocaleDateString("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" })} ${timeOf(last.started_at)}–${timeOf(last.ended_at)}${last.location ? ` · 📍 ${last.location}` : ""}`) : null);
  return [
    status,
    cheerCard(who),
    heroCard(who),
    activityCard(who, sessions, "Activity"),
    moduleSplit(modules || [], who.name),
    badgesSection(who),
    recentSessions(sessions, who.name, 10),
    h("p", { class: "small muted watch-note" }, `${who.name} shared this page with you. It keeps itself up to date, and ${who.name} can turn the link off at any time.`),
  ];
}

/* Someone watching can cheer the person on: an emoji, and a note if they like. It reaches them like a hype
   (watch_cheer). Made once and kept, so the page updating itself every minute doesn't wipe a half-written note. */
let cheerNode = null;
function cheerCard(who) {
  if (cheerNode) return cheerNode;
  const note = h("input", { id: "cheer-note", class: "input", maxlength: 140, placeholder: "Add a note (optional)", autocomplete: "off", "aria-label": "A note to go with it" });
  let busy = false;
  const send = async (kind, emoji) => {
    if (busy) return;
    busy = true;
    const { error } = await db.rpc("watch_cheer", { p_token: state.watchToken, p_kind: kind, p_note: note.value.trim() || null });
    busy = false;
    if (error) return oops(error);
    note.value = "";
    confetti([emoji, "✨", emoji]);
    toast(`Sent ${emoji} to ${who.name}`);
  };
  cheerNode = h("section", { class: "card cheer-card" },
    h("h2", null, `Cheer ${who.name} on`),
    h("p", { class: "small muted" }, `Tap one and ${who.name} gets it straight away${state.watching?.label ? `, from “${state.watching.label}”` : ""}.`),
    h("div", { class: "cheer-row", role: "group", "aria-label": "Send a cheer" }, CHEERS.map(([kind, emoji]) =>
      h("button", { type: "button", class: "react-pick", "aria-label": `Send ${emoji}`, onclick: () => send(kind, emoji) }, emoji))),
    note);
  return cheerNode;
}

/** Everyone in the crew: who's studying right now, and the board. */
function watchCrew() {
  const live = state.people.filter((p) => p.live_started_at).sort((a, b) => +new Date(a.live_started_at) - +new Date(b.live_started_at));
  return [
    h("section", { class: "section watch-live" },
      h("div", { class: "section-head" }, h("h2", null, "Locked in right now"), h("small", null, [live.length ? `${live.length} studying` : "", state.breaks.length ? `${state.breaks.length} on a break` : ""].filter(Boolean).join(" · "))),
      live.length || state.breaks.length
        ? [...studyGroups(live, groupOf).map(liveGroup), ...state.breaks.map(breakCard)]
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

/**
 * The parts of the running sitting already saved, oldest first. A break or a
 * module switch saves the stretch so far and starts the clock again, so after
 * one the session began with the first of these, not with the running stretch.
 */
function sittingStretches(live) {
  if (!live?.sitting_started_at || !live.banked_seconds) return [];
  const from = +new Date(live.sitting_started_at), to = +new Date(live.started_at);
  return state.mine.filter((x) => +new Date(x.started_at) >= from && +new Date(x.ended_at) <= to)
    .sort((a, b) => +new Date(a.started_at) - +new Date(b.started_at));
}

/** Fix the timer that's running: the module, when the session really began, where you are, or when you stopped and forgot to say. */
function editTimerSheet() {
  const live = state.live;
  if (!live) return;
  const earlier = sittingStretches(live);
  const first = earlier[0] || null;
  // The session began with its first saved part if there's been a break or a switch, otherwise with the clock.
  const began = first ? first.started_at : live.started_at;
  const restarted = new Date(live.started_at);
  const names = [...new Set([live.subject, ...activeModules().map((m) => m.name)])];
  const subject = h("select", { class: "input" }, names.map((name) => h("option", { value: name, selected: name === live.subject }, name)));
  const from = h("input", { class: "input", type: "time", value: timeOf(began) });
  const place = h("input", { class: "input", maxlength: 80, value: live.location || "", placeholder: "Main Library, café, home…" });
  const save = h("button", { class: "btn" }, "Save");
  const to = h("input", { class: "input", type: "time", "aria-describedby": "stopped-hint", oninput: () => { save.textContent = to.value ? "Save and stop" : "Save"; } });
  save.addEventListener("click", async () => {
    if (!from.value) return toast("Pick when you started.", { bad: true });
    const now = new Date();
    // An unchanged time keeps its seconds; a changed one is the latest time it's been that o'clock.
    const start = from.value === timeOf(began) ? new Date(began) : lastTimeAt(from.value, now);
    const end = to.value ? lastTimeAt(to.value, now) : null;
    // What's still running starts at the restart after a break or switch; otherwise it's the whole session.
    const running = first ? restarted : start;
    if (end && first && end <= restarted) return toast(`That's before the clock restarted at ${timeOf(restarted)}. To drop that last part, use “Cancel this stretch”.`, { bad: true });
    if (end && end <= start) return toast(`That's before you started, at ${timeOf(start)}.`, { bad: true });
    if (end && +end - +running < MIN_SESSION_MS) return toast("A session needs at least a minute.", { bad: true });
    if (first && +new Date(first.ended_at) - +start < MIN_SESSION_MS) return toast(`The first part of this session ended at ${timeOf(first.ended_at)}, so it has to start before that.`, { bad: true });
    if (first && +new Date(first.ended_at) - +start > MAX_SESSION_MS) return toast("Keep a session under 16 hours.", { bad: true });
    if (+(end || now) - +running > MAX_SESSION_MS) return toast(end ? "Keep a session under 16 hours." : "A timer can go back 16 hours at most.", { bad: true });
    // The database only checks sessions against each other, so check the running one here (and leave out this session's own parts,
    // by id: the list may have been reloaded since the sheet opened).
    const own = new Set(earlier.map((x) => x.id));
    const until = first ? new Date(first.ended_at) : end || now;
    const clash = state.mine.find((x) => !own.has(x.id) && +new Date(x.ended_at) > +start && +new Date(x.started_at) < +until);
    if (clash) return toast(`That would overlap your ${clash.subject} session, which ended at ${timeOf(clash.ended_at)}.`, { bad: true });
    // Editing it counts as being here.
    const row = { subject: subject.value, checked_at: now.toISOString(), sitting_started_at: start.toISOString(), ...(state.me.share_location ? { location: place.value.trim() || null } : {}) };
    if (!first) row.started_at = start.toISOString();
    else if (+start !== +new Date(first.started_at)) {
      // Moving the session's start moves its first saved part, and the time banked from before the break with it.
      const { data: moved, error } = await db.from("sessions").update({ started_at: start.toISOString() }).eq("id", first.id).select("id");
      if (error) return oops(sessionError(error));
      if (!moved?.length) return oops({ message: "That part of the session isn't there any more." });
      row.banked_seconds = Math.max(0, (live.banked_seconds || 0) + Math.round((+new Date(first.started_at) - +start) / 1000));
    }
    // Only this timer: if it was stopped or replaced on another device, nothing changes.
    const { data, error } = await db.from("live").update(row).eq("user_id", state.user.id).eq("session_id", live.session_id)
      .select("session_id, subject, started_at, sitting_started_at, location, banked_seconds, checked_at");
    if (error) return oops(error);
    if (!data?.length) { close(); await refresh(); render(); return toast("That timer isn't running any more.", { bad: true }); }
    state.live = { ...live, ...data[0] };
    close();
    if (end) return finish({ end });
    await refresh(); render();
    toast("Timer updated.");
  });
  const close = sheet((box, close) => box.append(
    h("h2", null, "Edit your timer"),
    h("p", { class: "muted", style: { marginTop: "4px" } }, "Wrong module, started before you pressed the button, or forgot to stop? Fix it here."),
    h("label", { class: "field" }, h("span", { class: "label" }, "Module"), subject),
    h("label", { class: "field" }, h("span", { class: "label" }, "Started at"), from,
      first ? h("span", { class: "small muted", style: { display: "block", marginTop: "6px" } }, `When the session began. The clock restarted at ${timeOf(restarted)} after a break or a switch.`) : null),
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
document.addEventListener("visibilitychange", () => { if (!document.hidden && state.me && state.crews.length) { showPings(); refreshSoon(); } });

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
