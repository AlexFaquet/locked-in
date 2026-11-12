import { test, before } from "node:test";
import assert from "node:assert/strict";
import { startDatabase, as, person } from "./db/postgres.mjs";

// The rules that matter most, checked against the real schema in a local Postgres:
// who can see what, and what the shop lets people do. Needs `npm install`; skipped without it.
let db = null;
before(async () => { db = await startDatabase(); });
const t = (name, fn) => test(name, async (ctx) => { if (!db) return ctx.skip("npm install to run the database tests"); await fn(); });

const ANA = "00000000-0000-0000-0000-00000000000a", BEN = "00000000-0000-0000-0000-00000000000b", CAT = "00000000-0000-0000-0000-00000000000c";
const one = async (uid, sql) => (await as(db, uid, sql)).rows[0];
const rows = async (uid, sql) => (await as(db, uid, sql)).rows;
const refused = (uid, sql, why) => assert.rejects(() => as(db, uid, sql), (error) => { assert.match(error.message, why); return true; });
let gremlins, flat, hello;

t("the whole schema loads, and people and crews can be made", async () => {
  await person(db, ANA, "Ana"); await person(db, BEN, "Ben"); await person(db, CAT, "Cat");
  gremlins = (await one(ANA, "select (public.create_crew('Gremlins')).*")).code;
  flat = (await one(CAT, "select (public.create_crew('Flat 12')).*")).code;
  await as(db, BEN, `select public.join_crew('${gremlins}')`);
  assert.deepEqual((await rows(ANA, "select name from public.profiles order by name")).map((r) => r.name), ["Ana", "Ben"], "you see your crew, nobody else");
  assert.deepEqual((await rows(CAT, "select name from public.profiles")).map((r) => r.name), ["Cat"]);
});

t("sessions count towards the board, coins and badges", async () => {
  // Fifteen hours, an hour each, a day apart.
  await db.exec(`insert into public.sessions (user_id, subject, started_at, ended_at)
    select '${ANA}', 'Maths', now() - (i || ' days')::interval - interval '2 hours', now() - (i || ' days')::interval - interval '1 hour' from generate_series(1, 15) i`);
  const stats = await one(ANA, `select * from public.room_stats() where user_id = '${ANA}'`);
  assert.equal(stats.total_minutes, 900);
  assert.equal((await one(ANA, "select public.my_wallet() as w")).w.coins, 150, "ten coins an hour");
  const earned = (await one(ANA, `select facts from public.crew_badges() where user_id = '${ANA}'`)).facts.earned;
  assert.ok(earned.includes("first") && earned.includes("ten"));
  assert.equal((await rows(BEN, "select * from public.messages where badges is not null")).length, 1, "badges are announced to the crew");
});

t("you can't write sessions, coins or things for anyone else", async () => {
  await refused(BEN, `insert into public.sessions (user_id, subject, started_at, ended_at) values ('${ANA}', 'x', now() - interval '2 hours', now() - interval '1 hour')`, /row-level security/);
  await refused(ANA, `insert into public.items (user_id, item, kind, price) values ('${ANA}', 'prism', 'frame', 0)`, /permission denied/);
  await refused(ANA, "select * from private.loadouts", /permission denied/);
  await refused(ANA, `select private.coins_of('${BEN}')`, /permission denied/);
  await refused(null, "select public.my_wallet()", /permission denied/);
});

t("the shop charges, checks and lets you wear what you have", async () => {
  await refused(BEN, "select public.shop_buy('coral')", /Not enough coins: that's 60 and you have 0/);
  await refused(ANA, "select public.shop_buy('coffee')", /Treats are for giving/);
  await refused(ANA, "select public.shop_wear('color', 'coral')", /don't have that yet/);
  assert.equal((await one(ANA, "select public.shop_buy('coral') as r")).r.coins, 90);
  await refused(ANA, "select public.shop_buy('coral')", /already have that/);
  await as(db, ANA, "select public.shop_wear('color', 'coral')");
  assert.equal((await one(BEN, `select * from public.crew_flair() where user_id = '${ANA}'`)).color, "coral", "the crew sees it");
});

t("gifts go only to crewmates, and stay when the giver leaves", async () => {
  await refused(ANA, `select public.shop_buy('coffee', '${CAT}')`, /someone in your crew/);
  assert.equal((await one(ANA, `select public.shop_buy('coffee', '${BEN}') as r`)).r.coins, 80);
  assert.equal((await one(ANA, `select public.shop_buy('ocean', '${BEN}') as r`)).r.coins, 20);
  await refused(ANA, `select public.shop_buy('ocean', '${BEN}')`, /They already have that one/);
  assert.deepEqual((await one(BEN, "select public.my_wallet() as w")).w, { coins: 0, owned: ["ocean"] });
  assert.deepEqual((await one(ANA, `select treats from public.crew_flair() where user_id = '${BEN}'`)).treats, { coffee: 1 });
  assert.equal((await rows(CAT, "select * from public.items")).length, 0);
});

t("reactions stay inside the crew", async () => {
  hello = (await one(ANA, `insert into public.messages (crew_id, body) select id, 'hello' from public.crews where code = '${gremlins}' returning id`)).id;
  await as(db, BEN, `insert into public.reactions (message_id, kind) values ('${hello}', 'heart')`);
  await refused(BEN, `insert into public.reactions (message_id, kind) values ('${hello}', 'heart')`, /duplicate key/);
  await refused(CAT, `insert into public.reactions (message_id, kind) values ('${hello}', 'fire')`, /row-level security/);
  await refused(BEN, `insert into public.reactions (message_id, user_id, kind) values ('${hello}', '${ANA}', 'fire')`, /permission denied/);
  assert.equal((await rows(ANA, "select * from public.reactions")).length, 1);
  assert.equal((await rows(CAT, "select * from public.reactions")).length, 0);
  await as(db, ANA, `delete from public.reactions where user_id = '${BEN}'`);
  assert.equal((await rows(BEN, "select * from public.reactions")).length, 1, "you can't take back someone else's");
});

t("someone watching can cheer, only through a link that's on", async () => {
  const token = (await one(ANA, "select public.create_watch_link('Mum and Dad') as t")).t;
  await refused(null, "select public.watch_cheer('w_wrong', 'heart')", /turned off/);
  await refused(null, `select public.watch_cheer('${token}', 'poo')`, /Pick one/);
  await as(db, null, `select public.watch_cheer('${token}', 'heart', '  Proud of you!  ')`);
  await refused(null, `select public.watch_cheer('${token}', 'clap')`, /just sent one/);
  await refused(null, "select * from public.watch_cheers", /permission denied/);
  assert.deepEqual(await rows(ANA, "select from_label, kind, note from public.watch_cheers"), [{ from_label: "Mum and Dad", kind: "heart", note: "Proud of you!" }]);
  assert.equal((await rows(BEN, "select * from public.watch_cheers")).length, 0);
  const watched = (await one(null, `select public.watch_stats('${token}') as w`)).w;
  assert.equal(watched.label, "Mum and Dad");
  assert.ok(watched.flair.some((f) => f.user_id === ANA && f.color === "coral"));
});

t("deleting your account takes your things, and leaves what you gave", async () => {
  await as(db, ANA, `delete from public.profiles where id = '${ANA}'`);
  assert.deepEqual((await one(BEN, "select public.my_wallet() as w")).w, { coins: 0, owned: ["ocean"] });
  assert.equal((await rows(BEN, "select * from public.items where paid_by is null")).length, 2);
  assert.equal((await db.query("select count(*)::int as n from public.sessions")).rows[0].n, 0);
});
