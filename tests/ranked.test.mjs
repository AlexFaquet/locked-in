import { test } from "node:test";
import assert from "node:assert/strict";
import { TIERS, RANKED_WEEKS, rankedFor, weekHours, tierMove, ukDay, dayStart } from "../game.mjs";

const now = new Date("2026-11-11T12:00:00Z");
/** `minutes` a day for the `count` days up to and including the one `ago` days back. */
const run = (minutes, count, ago = 0) => Object.fromEntries(Array.from({ length: count }, (_, i) => [ukDay(dayStart(now, -ago - i)), minutes]));

test("tiers climb, from any study at all", () => {
  assert.deepEqual(TIERS.map((tier) => tier.name), ["Bronze", "Silver", "Gold", "Platinum", "Diamond", "Master", "Titan", "Mythic"]);
  assert.equal(TIERS[0].minutes, 0);
  assert.ok(TIERS.every((tier, i) => !i || tier.minutes > TIERS[i - 1].minutes));
  assert.equal(RANKED_WEEKS, 2);
});

test("your tier is your average week over the last two", () => {
  // An hour a day for ten weeks: 7h a week.
  const steady = rankedFor(run(60, 70), now);
  assert.deepEqual([steady.tier.name, steady.weeks, steady.total, steady.average], ["Gold", 2, 14 * 60, 7 * 60]);
  assert.equal(steady.next.name, "Platinum");
  assert.equal(steady.toNext, (10 - 7) * 60 * 2, "three more hours a week, over two weeks");
  assert.equal(steady.ratio, 0.25);
  assert.equal(rankedFor(run(360, 70), now).tier.name, "Mythic");
  assert.equal(rankedFor(run(360, 70), now).next, null);
  assert.equal(rankedFor(run(360, 70), now).toNext, 0);
});

test("ease off and you drop; stop for two weeks and you're unranked", () => {
  // Three hours a day until a week ago, nothing since: 21h a week became 10.5h.
  assert.equal(rankedFor(run(180, 70, 7), now).tier.name, "Platinum");
  // Stopped ten days ago: four days of it left in the window, 6h a week.
  assert.equal(rankedFor(run(180, 70, 10), now).tier.name, "Gold");
  const gone = rankedFor(run(180, 40, 14), now);
  assert.deepEqual([gone.tier, gone.next.name, gone.total], [null, "Bronze", 0]);
  assert.deepEqual([rankedFor({}, now).tier, rankedFor(undefined, now).tier], [null, null]);
});

test("someone new is averaged over the weeks they've had", () => {
  // Five hours on their first day is a 5h week, not a quarter of one.
  const fresh = rankedFor(run(300, 1), now);
  assert.deepEqual([fresh.tier.name, fresh.weeks], ["Silver", 1]);
  assert.equal(rankedFor(run(60, 8), now).weeks, 2);
  assert.equal(rankedFor(run(60, 22), now).weeks, 2, "never more than the window");
  // Tomorrow's date (a clock ahead of St Andrews) doesn't count.
  assert.equal(rankedFor({ [ukDay(dayStart(now, 1))]: 600 }, now).tier, null);
});

test("a change of tier is a promotion or a drop", () => {
  assert.deepEqual([tierMove(1, 2), tierMove(2, 1), tierMove(2, 2), tierMove(-1, 0), tierMove(0, -1)], ["up", "down", null, "up", "down"]);
  assert.deepEqual([weekHours(744), weekHours(600), weekHours(0)], ["12.4h", "10h", "0h"]);
});
