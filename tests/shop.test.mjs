import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SHOP, SHOP_KINDS, shopItem, COINS_PER_HOUR, REACTIONS, CHEERS, reactionChips, groupedLines } from "../game.mjs";

const schema = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");
/** The keys a check constraint allows: `kind in ('a', 'b')` after `table`. */
const allowed = (table) => {
  const block = schema.match(new RegExp(`create table ${table.replace(".", "\\.")} \\(([\\s\\S]*?)\\n\\);`));
  assert.ok(block, `${table} in schema.sql`);
  return [...block[1].match(/kind text not null check \(kind in \(([^)]*)\)\)/)[1].matchAll(/'([^']+)'/g)].map(([, key]) => key);
};

// The database charges for things (private.shop_items) and the app shows them (SHOP):
// the same id, kind and price for every one, or someone pays a price they weren't shown.
test("the database's shop matches the app's", () => {
  const block = schema.match(/insert into private\.shop_items \(id, kind, price\) values([\s\S]*?);/);
  assert.ok(block, "shop_items values in schema.sql");
  const rows = [...block[1].matchAll(/\('([^']+)', '([^']+)', (\d+)\)/g)].map(([, id, kind, price]) => ({ id, kind, price: Number(price) }));
  assert.deepEqual(rows, SHOP.map(({ id, kind, price }) => ({ id, kind, price })));
  assert.deepEqual([...new Set(SHOP.map((item) => item.kind))], SHOP_KINDS.map(([kind]) => kind));
  assert.deepEqual(allowed("private.shop_items"), SHOP_KINDS.map(([kind]) => kind));
  assert.equal(new Set(SHOP.map((item) => item.id)).size, SHOP.length, "ids are unique");
  assert.ok(SHOP.filter((item) => item.kind === "tag" || item.kind === "treat").every((item) => item.icon), "tags and treats have an icon");
  assert.equal(shopItem("prism").price, 350);
  assert.equal(shopItem("gone"), null);
});

test("coins are ten an hour, counted by the database", () => {
  assert.equal(COINS_PER_HOUR, 10);
  // floor(seconds / 360) is 10 an hour.
  assert.match(schema, /floor\(sum\(extract\(epoch from s\.ended_at - s\.started_at\)\) \/ 360\)/);
});

test("the database allows exactly the reactions and cheers the app sends", () => {
  assert.deepEqual(allowed("public.reactions"), REACTIONS.map(([kind]) => kind));
  assert.deepEqual(allowed("public.watch_cheers"), CHEERS.map(([kind]) => kind));
  const inFunction = schema.match(/p_kind not in \(([^)]*)\)/)[1];
  assert.deepEqual([...inFunction.matchAll(/'([^']+)'/g)].map(([, kind]) => kind), CHEERS.map(([kind]) => kind));
});

test("reactions gather into chips, in the picker's order", () => {
  const chips = reactionChips([{ user_id: "b", kind: "fire" }, { user_id: "a", kind: "heart" }, { user_id: "b", kind: "heart" }], "a");
  assert.deepEqual(chips.map((chip) => [chip.kind, chip.count, chip.mine]), [["heart", 2, true], ["fire", 1, false]]);
  assert.deepEqual(chips[0].who, ["a", "b"]);
  assert.deepEqual(reactionChips(undefined, "a"), []);
});

test("gifts and cheers waiting to be seen group by who and what", () => {
  const gifts = [
    { id: 1, paid_by: "luke", item: "coffee", created_at: "2026-11-11T10:00:00Z" },
    { id: 2, paid_by: "luke", item: "coffee", created_at: "2026-11-11T10:05:00Z" },
    { id: 3, paid_by: "mia", item: "rose", created_at: "2026-11-11T10:02:00Z" },
  ];
  const lines = groupedLines(gifts, (gift) => `${gift.paid_by}:${gift.item}`);
  assert.deepEqual(lines.map((line) => [line.paid_by, line.item, line.count, line.last]), [["luke", "coffee", 2, "2026-11-11T10:05:00Z"], ["mia", "rose", 1, "2026-11-11T10:02:00Z"]]);
});
