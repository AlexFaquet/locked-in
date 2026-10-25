# Locked In 🔒

Study with your friends. See who's locked in right now and where, race the
weekly board, keep your streak alive.

**Open it:** https://alexfaquet.github.io/locked-in/ — on a phone, use
Share → *Add to Home Screen* so it opens like an app and keeps your account.

## How it works

- **Join with a name and an emoji.** There's no email or password: your
  account is an anonymous Supabase account kept in your browser. Clearing site
  data or switching phones starts a new one.
- **Crews are invite-only.** You see yourself and the people who share a
  crew with you, nobody else. Start a crew to get an eight-character code, or
  open someone's invite link (`?join=CODE`).
- **Lock in** on a subject, optionally saying where. Your crew sees you live,
  with a ticking clock, and can tap *I'm coming* or *Hype*. You get a toast,
  and a notification if you've turned them on while the app is open.
- **Earn XP** — a point a minute. Levels get steeper (Level 2 at 2.5 hours,
  Level 5 at 40, Level 10 at 202.5). Streaks count days with 30+ minutes;
  badges are for early starts, late nights, long sessions and milestones.
- **The board** resets every Monday at midnight. It shows the podium, how far
  you are from the next place, and the crew's recent sessions.
- **Location is opt-in.** Turn off *Share where I study* and it's hidden
  everywhere, including places already on past sessions.

## The database

Supabase project `locked-in` (London). The whole schema is in
[`supabase/schema.sql`](supabase/schema.sql); every table has row-level
security:

| Table | Who sees it | Who changes it |
|---|---|---|
| `profiles` | you and your crewmates | you |
| `crews`, `crew_members` | members | `create_crew` / `join_crew`; you can leave |
| `sessions` | you and your crewmates | you |
| `live` | you and your crewmates | you |
| `pings` | sender and recipient | the sender, two minutes apart per kind |
| `link_keys` | you (never the key itself) | you |

`room_stats(tz)` returns the board for everyone you can see: week, today and
all-time minutes, streak days, and the counts the badges use. Realtime
publishes `live`, `sessions` and `pings`; stopping a timer clears your `live`
row rather than deleting it, because Realtime can't apply row-level security
to deletes.

The Supabase advisor flags `create_crew` and `join_crew` as security-definer
functions that signed-in users can call. That's deliberate: joining by code
has to find a crew you can't see yet. Both check the caller and change only
the caller's own membership.

`config.js` holds the project URL and the **publishable** key. They're meant
to be public; what anyone can do is decided by the rules above.

## Linking another app

An app of your own can sync with your account. Open Locked In once with
`?link` on the end of the address and Me shows **Linked app**. *Link an app*
makes a code holding the project URL, the publishable key and a link key;
paste it into the other app. That app then calls `link_sync(key, payload)`,
which finds the key's owner by its SHA-256 and acts only for them: it can add,
change and remove that person's sessions and running timer, and read their
crew's board. *Unlink* revokes the key immediately.

Which sessions came through a link is kept in a private table that only
`link_sync` reads, so crewmates can't tell how anyone's time got there.

## Developing

No build step. Serve the folder and open it:

```bash
python3 -m http.server 8766
node --test tests/*.test.mjs   # levels, streaks, badges, the board
```

`supabase/schema.sql` is what the project has now. It was applied in parts,
some through the dashboard's SQL editor, so the project's migration history
doesn't list all of it.
