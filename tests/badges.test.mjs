import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BADGES, badgesFor } from "../game.mjs";

// The database awards badges (private.badge_rules) and the app shows them (BADGES):
// the same record and goal for every one, or someone gets announced for a badge the app doesn't show.
test("the database's badge rules match the app's badges", () => {
  const schema = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");
  const block = schema.match(/insert into private\.badge_rules \(id, fact, goal\) values([\s\S]*?);/);
  assert.ok(block, "badge_rules values in schema.sql");
  const rules = [...block[1].matchAll(/\('([^']+)', '([^']+)', (\d+)\)/g)].map(([, id, fact, goal]) => ({ id, fact, goal: Number(goal) }));
  assert.deepEqual(rules, BADGES.map((badge) => ({ id: badge.id, fact: badge.key, goal: badge.goal })));
});

test("a badge the database recorded stays earned", () => {
  const shift = (facts) => badgesFor(facts).find((badge) => badge.id === "shift");
  assert.equal(shift({ longest_sitting: 200 }).got, false);
  assert.equal(shift({ longest_sitting: 200, earned: ["shift"] }).got, true, "the 8-hour session was deleted, the badge wasn't");
  assert.equal(shift({ longest_sitting: 200, earned: ["shift"] }).ratio, 1);
});
