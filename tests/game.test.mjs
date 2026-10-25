import { test } from "node:test";
import assert from "node:assert/strict";
import { levelFor, levelProgress, minutesForLevel, streakFrom, badgesFor, standings, chaseLine, hm, clock, untilReset, encodeLinkCode } from "../game.mjs";

test("levels get steeper and the bar measures progress inside one", () => {
  assert.deepEqual([0, 149, 150, 599, 600, 2400, 12150].map(levelFor), [1, 1, 2, 2, 3, 5, 10]);
  assert.equal(minutesForLevel(2), 150);
  const p = levelProgress(375);
  assert.deepEqual([p.level, p.title, p.into, p.span, p.toNext], [2, "Note Taker", 225, 450, 225]);
  assert.equal(levelProgress(999999).title, "Legend");
});

test("a streak counts 30-minute days and today only breaks it once it's over", () => {
  const now = new Date(2026, 9, 25, 10);
  const days = { "2026-10-22": 40, "2026-10-23": 90, "2026-10-24": 31 };
  assert.equal(streakFrom(days, now), 3, "today not studied yet still keeps yesterday's streak");
  assert.equal(streakFrom({ ...days, "2026-10-25": 45 }, now), 4);
  assert.equal(streakFrom({ ...days, "2026-10-24": 29 }, now), 0);
  assert.equal(streakFrom({}, now), 0);
});

const person = (user_id, name, week_minutes, extra = {}) => ({ user_id, name, week_minutes, total_minutes: 0, days: {}, session_count: 0, early_sessions: 0, late_sessions: 0, longest_minutes: 0, ...extra });

test("the board ranks the week and tells you who to catch", () => {
  const ranked = standings([person("a", "Alex", 300), person("b", "Bea", 420), person("c", "Cal", 300, { days: { [`2026-10-24`]: 60 } })], "week_minutes", new Date(2026, 9, 25, 9));
  assert.deepEqual(ranked.map((p) => [p.name, p.rank]), [["Bea", 1], ["Cal", 2], ["Alex", 3]], "ties go to the longer streak");
  assert.equal(chaseLine(ranked, "a"), "1m to overtake Cal for #2.");
  assert.equal(chaseLine(ranked, "b"), "You're top — 2h 00m clear of Cal.");
  assert.equal(chaseLine([ranked[0]], "b"), null);
});

test("badges come from the stats the database returns", () => {
  const got = badgesFor(person("a", "A", 1300, { session_count: 4, longest_minutes: 200, total_minutes: 700 }), 2).filter((b) => b.got).map((b) => b.id);
  assert.deepEqual(got, ["first", "marathon", "ten", "warrior"]);
});

test("formatting", () => {
  assert.deepEqual([hm(0), hm(45), hm(65), hm(600)], ["0m", "45m", "1h 05m", "10h 00m"]);
  assert.equal(clock(3729000), "1:02:09");
  assert.equal(untilReset(new Date(2026, 9, 25, 22, 30)), "1h 30m", "Sunday night: resets at midnight");
  assert.equal(untilReset(new Date(2026, 9, 26, 0, 0)), "7d 0h", "Monday at midnight: a whole week to go");
  const code = encodeLinkCode({ url: "https://x.supabase.co", key: "sb_publishable_1", link: "li_abc" });
  assert.deepEqual(JSON.parse(Buffer.from(code.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()), { u: "https://x.supabase.co", k: "sb_publishable_1", l: "li_abc" });
});
