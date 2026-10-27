import { test } from "node:test";
import assert from "node:assert/strict";

// A phone in Thailand (7 hours ahead of the UK in winter, 6 in summer).
// Everything should still come out in St Andrews time.
process.env.TZ = "Asia/Bangkok";
const { ukDay, ukAt, ukClock, dayStart, weekStart, untilReset, streakFrom, weeksFrom } = await import("../game.mjs");
const at = (iso) => new Date(iso);

test("the process really is on Bangkok time", () => {
  assert.equal(at("2026-10-26T20:30:00Z").getHours(), 3);
});

test("days and clock times are St Andrews ones", () => {
  // 20:30 Monday in the UK is 03:30 Tuesday in Bangkok.
  assert.equal(ukDay(at("2026-10-26T20:30:00Z")), "2026-10-26");
  const { h, mi, weekday } = ukClock(at("2026-10-26T20:30:00Z"));
  assert.deepEqual([h, mi, weekday], [20, 30, 0]);
  // Summer: the UK is an hour ahead of UTC.
  assert.equal(ukClock(at("2026-07-01T13:05:00Z")).h, 14);
});

test("times typed into a form are read as St Andrews times", () => {
  assert.equal(ukAt("2026-10-27", "14:05").toISOString(), "2026-10-27T14:05:00.000Z");
  assert.equal(ukAt("2026-07-01", "14:05").toISOString(), "2026-07-01T13:05:00.000Z");
  assert.equal(ukAt("2026-10-27", "23:30", 1).toISOString(), "2026-10-28T23:30:00.000Z");
  assert.ok(Number.isNaN(+ukAt("", "14:05")));
  assert.ok(Number.isNaN(+ukAt("2026-10-27", "")));
});

test("midnights and weeks, across the October clock change", () => {
  // Sunday 25 October 2026 is 25 hours long: it starts on summer time and ends on winter time.
  assert.equal(dayStart(at("2026-10-25T12:00:00Z")).toISOString(), "2026-10-24T23:00:00.000Z");
  assert.equal(dayStart(at("2026-10-25T12:00:00Z"), 1).toISOString(), "2026-10-26T00:00:00.000Z");
  assert.equal(weekStart(at("2026-10-25T12:00:00Z")).toISOString(), "2026-10-18T23:00:00.000Z");
  assert.equal(weekStart(at("2026-10-26T20:30:00Z")).toISOString(), "2026-10-26T00:00:00.000Z");
});

test("the board resets at St Andrews midnight", () => {
  assert.equal(untilReset(at("2026-10-26T20:30:00Z"), "day"), "3h 30m");
  assert.equal(untilReset(at("2026-10-25T22:30:00Z")), "1h 30m", "Sunday night: the week ends at midnight");
});

test("streaks and weekly totals count St Andrews days", () => {
  // 03:30 Tuesday in Bangkok, still Monday evening in the UK: Monday is today, not yesterday.
  const now = at("2026-10-26T20:30:00Z");
  assert.equal(streakFrom({ "2026-10-24": 40, "2026-10-25": 40, "2026-10-26": 40 }, now), 3);
  const weeks = weeksFrom({ "2026-10-26": 50, "2026-10-25": 30 }, now, 2);
  assert.deepEqual(weeks.map((w) => w.minutes), [30, 50]);
});
