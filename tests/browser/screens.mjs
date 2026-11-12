// Drives the app in a headless phone-sized browser, light and dark, through
// every main screen, with made-up crew data in place of the database (nothing
// reaches the real project). Fails on any page error, and saves a screenshot
// of each screen in tests/browser/shots/ to look over.
//
//   npm install && npx playwright install chromium   (once)
//   npm run test:browser

import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = new URL("../../", import.meta.url);
// A real path: the folder has a space in it, and a URL would write it as %20.
const SHOTS = fileURLToPath(new URL("./shots/", import.meta.url));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };

// The app's own files, as GitHub Pages would serve them.
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "") || "index.html";
  if (path.includes("..")) { res.writeHead(400).end(); return; }
  try { const body = await readFile(new URL(path, ROOT)); res.writeHead(200, { "content-type": TYPES[extname(path)] || "application/octet-stream" }).end(body); }
  catch (_) { res.writeHead(404).end(); }
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const BASE = `http://127.0.0.1:${server.address().port}/`;
await mkdir(SHOTS, { recursive: true });

const ME = "00000000-0000-0000-0000-00000000000a", JUNO = "00000000-0000-0000-0000-00000000000b", IVY = "00000000-0000-0000-0000-00000000000c", KIT = "00000000-0000-0000-0000-00000000000d";
const C1 = "11111111-0000-0000-0000-000000000001", C2 = "11111111-0000-0000-0000-000000000002";
const now = Date.now();
const iso = (msAgo) => new Date(now - msAgo).toISOString();
const H = 3600000, D = 86400000;
const dayKey = (ago) => new Date(now - ago * D).toLocaleDateString("en-CA", { timeZone: "Europe/London" });
const days = (minutes, count, from = 0) => Object.fromEntries(Array.from({ length: count }, (_, i) => [dayKey(from + i), minutes]));
const person = (user_id, name, emoji, d, extra = {}) => {
  const total = Object.values(d).reduce((a, b) => a + b, 0);
  return { user_id, name, emoji, live_subject: null, live_started_at: null, live_location: null, total_minutes: total + 2000, week_minutes: Math.round(total / 6), today_minutes: d[dayKey(0)] || 0, longest_minutes: 200, session_count: 40, early_sessions: 1, late_sessions: 2, days: d, ...extra };
};
const people = [
  person(ME, "Robin", "🦊", days(70, 60)),
  person(JUNO, "Juno", "🐼", days(190, 50), { live_subject: "CS3050", live_started_at: iso(40 * 60000), live_location: "Main Library" }),
  person(IVY, "Ivy", "🦉", days(30, 30)),
  person(KIT, "Kit", "🐸", days(100, 10, 40)),
];
const flair = [
  { user_id: ME, frame: "royal", color: "aurora", tag: "built-different", treats: { coffee: 3, pizza: 1 } },
  { user_id: JUNO, frame: "prism", color: "coral", tag: "night-shift", treats: { rose: 1, trophy: 2, cookie: 5 } },
  { user_id: IVY, frame: "frost", color: null, tag: null, treats: {} },
  { user_id: KIT, frame: null, color: "sunset", tag: null, treats: {} },
];
const msgs = [
  { id: "m1", crew_id: C1, user_id: JUNO, body: "Library at 2? I've got a table on level 3", badges: null, created_at: iso(50 * 60000), reactions: [{ user_id: ME, kind: "heart" }, { user_id: IVY, kind: "heart" }, { user_id: IVY, kind: "fire" }] },
  { id: "m2", crew_id: C1, user_id: ME, body: "On my way", badges: null, created_at: iso(45 * 60000), reactions: [{ user_id: JUNO, kind: "strong" }] },
  { id: "m3", crew_id: C1, user_id: IVY, body: "earned a badge", badges: ["marathon"], created_at: iso(30 * 60000), reactions: [{ user_id: JUNO, kind: "clap" }, { user_id: ME, kind: "clap" }] },
  { id: "m4", crew_id: C1, user_id: IVY, body: "Three hours straight. Never again 😂 https://example.com/notes", badges: null, created_at: iso(20 * 60000), reactions: [] },
];
const session = { access_token: ["eyJhbGciOiJIUzI1NiJ9", Buffer.from(JSON.stringify({ sub: ME, role: "authenticated", exp: Math.floor(now / 1000) + 3600 })).toString("base64url"), "sig"].join("."), refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(now / 1000) + 3600, user: { id: ME, aud: "authenticated", role: "authenticated", is_anonymous: true } };
const watch = { me: JUNO, label: "Mum and Dad", people, flair, live: [{ user_id: JUNO, subject: "CS3050", started_at: iso(40 * 60000), location: "Main Library", paused_at: null, paused_subject: null, banked_seconds: 0, now_playing: null, study_group: null }], feed: [], modules: [{ name: "CS3050", color: 0, week_minutes: 300, total_minutes: 3000 }], badges: [], sessions: [{ subject: "CS3050", started_at: iso(30 * H), ended_at: iso(27 * H), location: null }] };
const calls = [];
function answer(url, method, body) {
  const path = url.pathname.replace("/rest/v1/", "");
  const q = url.searchParams;
  calls.push(`${method} ${path}${method === "POST" ? " " + (body || "") : ""}`);
  switch (path) {
    case "profiles": return [{ id: ME, name: "Robin", emoji: "🦊", share_location: true }];
    case "crews": return [{ id: C1, name: "Night Owls", code: "ABCD2345", created_by: ME, crew_members: [{ count: 4 }] }, { id: C2, name: "Flat 12", code: "WXYZ6789", created_by: JUNO, crew_members: [{ count: 2 }] }];
    case "rpc/room_stats": return people;
    case "live": return [{ user_id: JUNO, session_id: "s", subject: "CS3050", started_at: iso(40 * 60000), sitting_started_at: iso(40 * 60000), location: "Main Library", paused_at: null, paused_subject: null, banked_seconds: 0, now_playing: null, checked_at: null, study_group: null }];
    case "sessions": return [{ id: "x1", user_id: JUNO, subject: "CS3050", started_at: iso(5 * H), ended_at: iso(3 * H), location: "Main Library" }, { id: "x2", user_id: ME, subject: "MT2501", started_at: iso(26 * H), ended_at: iso(24 * H), location: null }];
    case "link_keys": case "watch_links": return [];
    case "rpc/my_subject_stats": return [{ subject_id: "sub1", name: "MT2501", color: 0, archived: false, week_minutes: 200, total_minutes: 2000 }];
    case "messages": return q.get("select").includes("body") ? [...msgs].reverse() : msgs.map(({ id, crew_id, user_id, created_at }) => ({ id, crew_id, user_id, created_at })).concat([{ id: "m9", crew_id: C2, user_id: JUNO, created_at: iso(60000) }]);
    case "rpc/crew_badges": return people.map((p) => ({ user_id: p.user_id, facts: { sessions: 4, total_minutes: 3000, longest_sitting: 200, earned: ["first", "marathon"] } }));
    case "pings": return [{ id: 7, from_user: JUNO, kind: "cheer", created_at: iso(120000) }];
    case "rpc/crew_flair": return flair;
    case "rpc/my_wallet": return { coins: 265, owned: ["royal", "aurora", "built-different", "mint"] };
    case "items": return [{ id: 3, item: "coffee", kind: "treat", paid_by: JUNO, created_at: iso(90000) }, { id: 4, item: "coffee", kind: "treat", paid_by: JUNO, created_at: iso(80000) }, { id: 5, item: "ember", kind: "frame", paid_by: IVY, created_at: iso(70000) }];
    case "watch_cheers": return [{ id: 2, from_label: "Mum and Dad", kind: "heart", note: "So proud of you. Dinner's on us Sunday!", created_at: iso(60000) }];
    case "rpc/my_music": return { connected: false, lastfm: null, problem: null };
    case "rpc/crew_module_split": return [{ name: "CS3050", color: 0, week_minutes: 300, total_minutes: 3000 }];
    case "rpc/watch_stats": return watch;
    case "rpc/watch_cheer": return null;
    case "rpc/shop_wear": return null;
    case "rpc/shop_buy": return { coins: 200 };
    case "reactions": return null;
    default: console.log("UNHANDLED", method, path); return [];
  }
}
const browser = await chromium.launch();
const errors = [];
async function open(scheme, hash = "") {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme });
  await ctx.addInitScript(([s]) => { if (!location.hash.includes("watch")) localStorage.setItem("sb-dmuzyednlvftkoxqhzed-auth-token", JSON.stringify(s)); window.confirm = () => true; localStorage.setItem("lockedin.badges." + s.user.id, JSON.stringify(["first", "marathon", "ten", "fifty"])); localStorage.setItem("lockedin.tier." + s.user.id, "2"); }, [session]);
  await ctx.route("https://dmuzyednlvftkoxqhzed.supabase.co/**", async (route) => {
    const req = route.request(); const url = new URL(req.url());
    if (url.pathname.startsWith("/auth/")) return route.fulfill({ json: session.user });
    if (!url.pathname.startsWith("/rest/")) return route.abort();
    let data = answer(url, req.method(), req.postData());
    if ((req.headers().accept || "").includes("vnd.pgrst.object") && Array.isArray(data)) data = data[0];
    return route.fulfill({ status: data === null ? 204 : 200, contentType: "application/json", body: data === null ? "" : JSON.stringify(data), headers: { "access-control-allow-origin": "*" } });
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${scheme}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/WebSocket|ERR_FAILED|Failed to load resource/.test(m.text())) errors.push(`${scheme} console: ${m.text()}`); });
  await page.goto(BASE + hash);
  await page.waitForSelector(".tabs");
  await page.waitForTimeout(700);
  return { ctx, page };
}
const shot = (page, name) => page.screenshot({ path: `${SHOTS}${name}.png` });
const tab = (page, label) => page.locator(".tabs .tab", { hasText: label }).click();
for (const scheme of ["light", "dark"]) {
  const { ctx, page } = await open(scheme);
  await shot(page, `${scheme}-1-now-pings`);
  await page.locator(".pings .btn", { hasText: "Got it" }).click();
  await shot(page, `${scheme}-2-now`);
  await tab(page, "Board"); await page.locator(".toggle button", { hasText: "Ranked" }).click(); await page.waitForTimeout(200);
  await shot(page, `${scheme}-3-board-ranked`);
  await page.locator(".toggle button", { hasText: "This week" }).click();
  await tab(page, "Chat"); await page.waitForTimeout(500);
  await shot(page, `${scheme}-4-chat`);
  await page.locator(".msg-bubble").first().click(); await page.waitForTimeout(350);
  await shot(page, `${scheme}-5-react-sheet`);
  await page.locator(".react-pick").nth(1).click(); await page.waitForTimeout(400);
  await shot(page, `${scheme}-5b-after-react`);
  await tab(page, "Me"); await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}${scheme}-6-me.png`, clip: { x: 0, y: 0, width: 390, height: 1150 }, fullPage: true });
  await page.locator(".hero-banner").click(); await page.waitForTimeout(400);
  await shot(page, `${scheme}-7-ranked-sheet`);
  await page.locator(".sheet .link", { hasText: "Close" }).click(); await page.waitForTimeout(300);
  await page.locator(".hero-shop .btn").click(); await page.waitForTimeout(400);
  await shot(page, `${scheme}-8-shop`);
  await page.locator(".sheet").evaluate((el) => { el.scrollTop = el.scrollHeight; }); await page.waitForTimeout(200);
  await shot(page, `${scheme}-8b-shop-bottom`);
  if (scheme === "light") {
    await page.locator(".shop-item .btn", { hasText: "Wear" }).first().click(); await page.waitForTimeout(300);
    await page.locator(".shop-item .btn-gold").first().click(); await page.waitForTimeout(500);
  }
  await page.locator(".sheet .link", { hasText: "Close" }).click(); await page.waitForTimeout(300);
  await tab(page, "Board"); await page.locator(".rank-row", { hasText: "Juno" }).click(); await page.waitForTimeout(600);
  await shot(page, `${scheme}-9-profile`);
  await page.locator(".hero-gift").click(); await page.waitForTimeout(400);
  await shot(page, `${scheme}-10-gift`);
  if (scheme === "light") { await page.locator(".gift-item").first().click(); await page.waitForTimeout(500); await shot(page, `${scheme}-10b-gift-sent`); }
  await ctx.close();
  const w = await open(scheme, "#watch=w_secret");
  await shot(w.page, `${scheme}-11-watch`);
  if (scheme === "light") {
    await w.page.fill("#cheer-note", "Go on!");
    await w.page.locator(".cheer-card .react-pick").first().click(); await w.page.waitForTimeout(400);
    await shot(w.page, `${scheme}-11b-watch-cheered`);
  }
  await w.ctx.close();
}
await browser.close();
server.close();
// What the screens asked the database to do, in order.
const writes = calls.filter((c) => /^POST (rpc\/(shop_|watch_cheer)|reactions)/.test(c));
const expected = [
  'POST reactions {"message_id":"m1","kind":"fire"}',
  'POST rpc/shop_wear {"p_slot":"frame","p_item":null}',
  'POST rpc/shop_buy {"p_item":"ember"}',
  'POST rpc/shop_wear {"p_slot":"frame","p_item":"ember"}',
  `POST rpc/shop_buy {"p_item":"coffee","p_for":"${JUNO}"}`,
  'POST rpc/watch_cheer {"p_token":"w_secret","p_kind":"heart","p_note":"Go on!"}',
  'POST reactions {"message_id":"m1","kind":"fire"}',
];
const problems = [...errors];
if (JSON.stringify(writes) !== JSON.stringify(expected)) problems.push(`Unexpected writes:\n${writes.join("\n")}`);
if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
console.log(`Every screen worked, light and dark. Screenshots: ${SHOTS}`);
