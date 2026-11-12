# Working on Locked In

A study app for crews of friends: static files on GitHub Pages, Supabase
(project `dmuzyednlvftkoxqhzed`, London) for everything else. README.md
describes every feature and the database's rules; read it first.

**This repo is public and Pages serves every file in it, this one included.**
Nothing here may name or describe an app that links to Locked In, or anything
else private. Linked apps stay "a linked app" (see README → Linking another app).

## What matters most

- **Simplicity is the product.** Add polish, not settings. A feature should
  fit an existing screen or sheet before it gets a new one.
- **Existing data is sacred.** Migrations add; they don't rewrite or drop what
  people have. Before touching the live database, count the main tables
  (profiles, crews, crew_members, sessions, messages, pings, watch_links,
  private.earned_badges, subjects) and compare afterwards.
- **The database decides who sees what.** Every public table has RLS, `revoke
  all` from anon and authenticated, then only the grants it needs. Anything a
  person mustn't set themselves (coins, badges, who sent what) is written by a
  `security definer` function with `set search_path = ''` that checks the
  caller, with `execute` revoked from public and anon. app.js never filters
  for privacy.
- **St Andrews time everywhere** (`TZ` in game.mjs): days, weeks, board resets.

## The pieces

- `app.js`: the whole UI, plain DOM via `h()`. No framework, no build step.
- `game.mjs`: pure logic (levels, tiers, streaks, badges, shop, times), unit tested.
- `supabase/schema.sql`: the database **as it is now**. Change it in place
  when the database changes; it isn't a migration log. Lists the database
  keeps (badge rules, shop prices, reaction kinds) mirror game.mjs, and
  tests check they match.
- `supabase/functions/`: edge functions `pair` and `music`.

## Testing

```bash
npm install && npx playwright install chromium   # once
npm test                # game logic, and the real schema in a local Postgres
npm run test:browser    # every screen, light and dark, with made-up data
```

`npm test` loads all of schema.sql into PGlite (tests/db/postgres.mjs) and
signs in as made-up people, so a new rule can be tested before it goes live.
Add to tests/db.test.mjs for anything about who can see or do what.
The browser test never reaches the real project; look over the screenshots
in tests/browser/shots/ after changing the UI.

## Shipping

- Database: apply the migration (Supabase MCP `apply_migration`). If it's
  declined, put the SQL on the clipboard (`pbcopy`) and hand it over to paste
  into the dashboard's SQL editor. Then verify the counts, the new objects and
  `get_advisors`.
- Database first, then the app: push to `main` and Pages serves it in a minute
  or two. Open apps reload themselves when app.js changes.
- Writing: plain, friendly British English in the UI. Code comments say why.
