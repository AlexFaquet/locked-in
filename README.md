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
- **Pause** for a break. What you've done so far is saved straight away, and
  *Resume* carries on the same clock with the same module and place. Your crew
  sees you're on a break (for up to three hours), and a pause shows on every
  device you use. *Done* from a break ends the sitting with its XP.
- **Switch module** mid-session from the chips under the clock. The time so far
  is saved under the module it was on and the clock carries on, so one sitting
  can cover several modules and each still gets its hours. In the first minute
  a switch just relabels the timer (wrong button). Resuming from a break lets
  you pick the module too.
- **Fix the times.** *Edit* under the running clock changes its module, when
  you really started, or where you are. If you forgot to stop it, set
  *Stopped at* and it ends there, as if you'd pressed Done then. In Me → *Your sessions*, ✎ changes a
  saved session's module, day and times, and *+ Log one* adds one you forgot
  to time. Nothing can overlap another session, end in the future or run
  past 16 hours, and the board updates to match.
- **Still locked in?** A timer nobody has touched for 3 hours (since it
  started, a switch, a resume, an edit or the last "yes") asks if you're
  still there. It keeps running either way, but until you answer your crew
  doesn't see you as live and the board stops counting at the 3-hour mark.
  *Yes, still going* puts it all back; *I stopped earlier* opens Edit, where
  *Stopped at* saves what you really did.
- **Earn XP** — a point a minute. Levels get steeper (Level 2 at 2.5 hours,
  Level 5 at 40, Level 10 at 202.5). Streaks count days with 30+ minutes;
  badges are for early starts, late nights, long sessions and milestones.
- **Profiles.** Tap anyone on the board, the podium, the live list or the
  feed to see their level, streak, badges, activity and recent sessions. Your
  own is under Me. *Activity* switches between **Weekly** (hours per week for
  ten weeks, this week bright) and **Daily** (every day as a square). Tap or
  hover a bar or a square to see its total and which modules it went on.
  Everyone's module *list* stays private.
- **The board** has three races: *Today* (resets at midnight), *This week*
  (resets Monday at midnight) and *All time*. Each shows the podium, how far
  you are from the next place, and the crew's recent sessions. It remembers
  which one you last looked at.
- **Music.** Link Last.fm in Me and your crew sees what you're playing
  (song, artist, cover) while you're locked in, never otherwise. It goes
  through Last.fm because Spotify only lets five hand-added people use a
  small app; Last.fm has no limit, and anyone can connect Spotify to it
  themselves (Last.fm → Settings → Applications → Spotify Scrobbling). The
  `music` edge function checks the name you link and asks Last.fm what
  everyone locked in is playing every 30 seconds; nobody can set a track
  themselves. It needs a Last.fm API key (last.fm/api/account/create) as the
  function's `LASTFM_KEY` secret.
- **Let someone watch.** Me → *Let someone watch* makes a link for family,
  or anyone without an account. It opens a read-only page with two tabs:
  *you* (studying now or not, with the clock and where; today, this week,
  your streak, activity and recent sessions) and *Board* (who's locked in
  right now, the board and the crew's recent sessions). Places show only for
  people who share them with the crew, and a timer waiting on *Still locked
  in?* shows as not studying. Nobody can be tapped or pinged from it. The
  link is shown once (only a hash is kept), the page checks in every minute,
  and *Turn off* stops it straight away.
- **St Andrews time, everywhere.** Every clock time, day, week and board
  reset is UK time, whatever time zone the phone is in, and times typed into
  Edit or *Log a session* are read as UK times. So someone watching from
  abroad sees the same times as the crew.
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
| `watch_links` | you (never the link's secret) | you; whoever has a link sees your study and your crew's board, through `watch_stats` |

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
to deletes. A pause saves the stretch as a session and keeps `paused_at`,
`paused_subject` and `banked_seconds` on that row; the `live_pause` trigger
makes sure a running timer and a break never coexist.

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
