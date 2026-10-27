import { test } from "node:test";
import assert from "node:assert/strict";
import { levelFor, levelProgress, minutesForLevel, streakFrom, badgesFor, standings, chaseLine, hm, clock, untilReset, encodeLinkCode, weekStart, weeksFrom, subjectsBetween, hourTicks, shortHours, sittingMs, onBreak, BREAK_KEPT_MS, BREAK_SHOWN_MS, STILL_THERE_MS, hiddenFrom, unconfirmed } from "../game.mjs";

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
  // Someone watching sees it by name.
  assert.equal(chaseLine(ranked, "a", "week_minutes", "Ana"), "1m for Ana to overtake Cal for #2.");
  assert.equal(chaseLine(ranked, "b", "week_minutes", "Bo"), "Bo is top — 2h 00m clear of Cal.");
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
  assert.equal(untilReset(new Date(2026, 9, 26, 13, 20), "day"), "10h 40m", "the day's board resets at midnight");
  const code = encodeLinkCode({ url: "https://x.supabase.co", key: "sb_publishable_1", link: "li_abc" });
  assert.deepEqual(JSON.parse(Buffer.from(code.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()), { u: "https://x.supabase.co", k: "sb_publishable_1", l: "li_abc" });
});

test("weeks run Monday to Sunday and this week is the last, so far", () => {
  const sunday = new Date(2026, 9, 25, 20);
  assert.equal(weekStart(sunday).toDateString(), new Date(2026, 9, 19).toDateString());
  const weeks = weeksFrom({ "2026-10-19": 30, "2026-10-25": 45, "2026-10-18": 60, "2026-10-12": 15 }, sunday, 3);
  assert.deepEqual(weeks.map((w) => [w.start.getDate(), w.minutes, w.current]), [[5, 0, false], [12, 75, false], [19, 75, true]]);
});

test("a range's subjects, most first, by when each session started", () => {
  const at = (d, t) => new Date(`2026-10-${d}T${t}:00`).toISOString();
  const sessions = [
    { subject: "IR", started_at: at(22, "18:53"), ended_at: at(22, "21:00") },
    { subject: "Maths", started_at: at(22, "09:00"), ended_at: at(22, "09:30") },
    { subject: "IR", started_at: at(23, "13:10"), ended_at: at(23, "14:18") },
  ];
  assert.deepEqual(subjectsBetween(sessions, new Date(2026, 9, 22), new Date(2026, 9, 23)), [{ subject: "IR", minutes: 127 }, { subject: "Maths", minutes: 30 }]);
});

test("chart gridlines land on whole hours", () => {
  assert.deepEqual(hourTicks(0), { top: 60, step: 60 });
  assert.deepEqual(hourTicks(255), { top: 360, step: 120 });
  assert.deepEqual(hourTicks(750), { top: 900, step: 300 });
  assert.deepEqual([shortHours(255), shortHours(750)], ["4.3h", "13h"]);
});

test("a paused sitting keeps its time, and a break only lasts so long", () => {
  const now = Date.parse("2026-10-26T15:00:00Z");
  const running = { started_at: "2026-10-26T14:50:00Z", banked_seconds: 1800, paused_at: null };
  assert.equal(sittingMs(running, now), 40 * 60000, "30 minutes before the break and 10 since");
  const paused = { started_at: null, banked_seconds: 1800, paused_at: "2026-10-26T14:30:00Z" };
  assert.equal(sittingMs(paused, now), 30 * 60000, "the clock stands still on a break");
  assert.equal(sittingMs(null, now), 0);
  assert.equal(onBreak(paused, BREAK_SHOWN_MS, now), true);
  assert.equal(onBreak(paused, BREAK_SHOWN_MS, now + 3 * 3600000), false, "crewmates stop seeing an old break");
  assert.equal(onBreak(paused, BREAK_KEPT_MS, now + 3 * 3600000), true, "but you can still resume it");
  assert.equal(onBreak(running, BREAK_KEPT_MS, now), false, "studying isn't a break");
});

test("a timer untouched for 3 hours asks if you're still there", () => {
  const start = Date.parse("2026-10-27T14:00:00Z");
  const row = { started_at: "2026-10-27T14:00:00Z", checked_at: null };
  assert.equal(hiddenFrom(row), start + STILL_THERE_MS);
  assert.equal(unconfirmed(row, start + STILL_THERE_MS - 1000), false);
  assert.equal(unconfirmed(row, start + STILL_THERE_MS), true);
  // Saying "still here" at 17:30 gives it until 20:30.
  const checked = { ...row, checked_at: "2026-10-27T17:30:00Z" };
  assert.equal(unconfirmed(checked, Date.parse("2026-10-27T20:00:00Z")), false);
  assert.equal(unconfirmed(checked, Date.parse("2026-10-27T20:30:00Z")), true);
  // A new stretch (a switch, or back from a break) counts as touching it, even with an older "still here".
  const switched = { started_at: "2026-10-27T19:00:00Z", checked_at: "2026-10-27T17:30:00Z" };
  assert.equal(hiddenFrom(switched), Date.parse("2026-10-27T22:00:00Z"));
  // Nothing running, nothing to ask.
  assert.equal(hiddenFrom({ started_at: null, paused_at: "2026-10-27T14:00:00Z" }), null);
  assert.equal(unconfirmed(null), false);
});
