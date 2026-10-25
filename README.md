# Locked In 🔒

Study with your friends. See who's locked in right now and where, race the
weekly board, keep your streak alive.

**Open it:** https://alexfaquet.github.io/locked-in/ — on a phone, use
Share → *Add to Home Screen* so it opens like an app and keeps your account.

## How it works

- **Join with a name and an emoji.** There's no email or password; your
  account is a Supabase account kept on your device. To use it on a laptop or
  another phone, go to Me → *Add a device* for a six-character code, and on the
  new device tap *I already use Locked In on another device*. The code works
  once, for ten minutes. Add a second device before clearing a browser's data,
  or the account goes with it.
- **Crews are invite-only.** You see yourself and the people who share a
  crew with you, nobody else. Start a crew to get an eight-character code, or
  open someone's invite link (`?join=CODE`).
- **Your own modules.** After joining a crew you add what you study: course
  names, codes, anything. Nothing is assumed, and only you see the list. Me →
  *Your modules* shows hours this week and all time per module, and renames
  or archives them. Renaming also renames past sessions, so the hours stay
  together. A module with no time logged can be removed outright.
- **Lock in** on one of your modules, optionally saying where. Your crew sees you live,
  with a ticking clock, and can tap *I'm coming* or *Hype*. You get a toast,
  and a notification if you've turned them on while the app is open.
- **Earn XP** — a point a minute. Levels get steeper (Level 2 at 2.5 hours,
  Level 5 at 40, Level 10 at 202.5). Streaks count days with 30+ minutes;
  badges are for early starts, late nights, long sessions and milestones.
- **Profiles.** Tap anyone on the board, the podium, the live list or the
  feed to see their level, streak, badges, activity and recent sessions. Your
  own is under Me. *Activity* switches between **Weekly** (hours per week for
  ten weeks, this week bright) and **Daily** (every day as a square). Tap or
  hover a bar or a square to see its total and which modules it went on.
  Everyone's module *list* stays private.
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
| `subjects` (your modules) | you | you; unused ones can be removed, the rest archived |
| `link_keys` | you (never the key itself) | you |

Pairing a device: `create_pairing_code()` stores a hash of a one-time code,
and the `pair` edge function ([`supabase/functions/pair`](supabase/functions/pair/index.ts))
redeems it with `redeem_pairing_code()`, which only the service role can call.
It then issues a one-time sign-in for the code's owner, which the new device
exchanges for its own session. A sign-in needs an email address, so an account
that's paired gets a placeholder on the reserved `.invalid` domain. Nothing is
ever sent to it.

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
