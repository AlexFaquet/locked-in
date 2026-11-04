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

test("a badge the database still holds counts as earned", () => {
  const buddy = (facts) => badgesFor(facts).find((badge) => badge.id === "buddy");
  assert.equal(buddy({ together: 4 }).got, false);
  assert.equal(buddy({ together: 4, earned: ["buddy"] }).got, true, "the crewmate behind it left; the badge stays");
  assert.equal(buddy({ together: 4, earned: ["buddy"] }).ratio, 1);
});

// A corrected session should cost someone a badge it no longer supports, but a crewmate leaving shouldn't.
test("only crew badges outlast the records behind them", () => {
  const schema = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");
  const block = schema.match(/update private\.badge_rules set lasting = true where id in \(([^)]*)\)/);
  assert.ok(block, "lasting badges in schema.sql");
  const lasting = [...block[1].matchAll(/'([^']+)'/g)].map(([, id]) => id).sort();
  assert.deepEqual(lasting, BADGES.filter((badge) => badge.group === "crew").map((badge) => badge.id).sort());
});

// A day showing 30m on the flame has to count for the streak badges too.
test("streak badges count days the way the flame does", () => {
  const schema = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");
  assert.match(schema, /round\(sum\(extract\(epoch from t\.ended_at - t\.started_at\)\) \/ 60\)::integer as minutes/, "stats_for rounds each day");
  assert.match(schema, /good_days as \(select d\.user_id, d\.day from daily d where round\(d\.minutes\) >= 30\)/, "badge_facts rounds each day");
});
