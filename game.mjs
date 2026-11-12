// The game: levels, streaks, badges and the race. Pure functions over the
// stats the database returns (room_stats), so they're easy to test.

/** XP is minutes studied. Each level needs more than the last: L2 at 2.5h, L3 at 10h, L5 at 40h, L10 at 202.5h. */
export const levelFor = (minutes) => Math.floor(Math.sqrt(Math.max(0, minutes) / 60 / 2.5)) + 1;
export const minutesForLevel = (level) => Math.round(2.5 * (level - 1) ** 2 * 60);

/* The ranks, lowest first. Levels carry on past the last one, under the same name. */
export const RANKS = [
  ["🌱", "Fresh Starter"], ["📝", "Note Taker"], ["📚", "Library Regular"], ["🎯", "Focus Apprentice"], ["⛏️", "Deep Worker"],
  ["⚙️", "Study Machine"], ["🗡️", "Exam Slayer"], ["🎓", "Scholar"], ["♟️", "Grandmaster"], ["👑", "Legend"],
].map(([icon, title], i) => ({ level: i + 1, icon, title, minutes: minutesForLevel(i + 1) }));
export const titleFor = (level) => RANKS[Math.min(level, RANKS.length) - 1].title;

/** The whole ladder against someone's time: the ranks they've passed, the one they're on, and how far off the rest are. */
export function ranksFor(minutes) {
  const on = Math.min(levelFor(minutes), RANKS.length);
  return RANKS.map((rank) => ({ ...rank, status: rank.level < on ? "passed" : rank.level === on ? "current" : "ahead", left: Math.max(0, rank.minutes - minutes) }));
}

/** Where you are inside your current level, for the XP bar. */
export function levelProgress(minutes) {
  const level = levelFor(minutes);
  const from = minutesForLevel(level), to = minutesForLevel(level + 1);
  return { level, title: titleFor(level), into: minutes - from, span: to - from, toNext: to - minutes, ratio: (minutes - from) / (to - from) };
}

/* Time. Locked In runs on St Andrews time wherever you are, so a day, a week
   and every clock time mean the same for the whole crew, and for anyone
   watching from abroad. */
export const TZ = "Europe/London";

const wallClock = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" });

/** What a St Andrews clock reads at `date`: month 1–12, weekday 0 = Monday. */
export function ukClock(date) {
  const p = {};
  for (const { type, value } of wallClock.formatToParts(date)) p[type] = Number(value);
  return { y: p.year, m: p.month, d: p.day, h: p.hour, mi: p.minute, s: p.second, weekday: (new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay() + 6) % 7 };
}

/** The moment a St Andrews clock reads this. Days past the month's end roll over, so `d + 1` is tomorrow. */
export function ukTime(y, m, d, h = 0, mi = 0) {
  const wall = Date.UTC(y, m - 1, d, h, mi);
  const offset = (at) => { const c = ukClock(new Date(at)); return Date.UTC(c.y, c.m - 1, c.d, c.h, c.mi, c.s) - Math.floor(at / 1000) * 1000; };
  // UK time is UTC or an hour ahead; guessing twice settles it either side of a clock change.
  return new Date(wall - offset(wall - offset(wall)));
}

/** A day and time from form fields ("2026-10-27", "14:05") in St Andrews, `plusDays` on. Invalid if either is blank. */
export function ukAt(day, time, plusDays = 0) {
  const [y, m, d] = String(day).split("-").map(Number);
  const [h, mi] = String(time).split(":").map(Number);
  return [y, m, d, h, mi].every(Number.isFinite) ? ukTime(y, m, d + plusDays, h, mi) : new Date(NaN);
}

/** "2026-10-27": the St Andrews date at `date`, the key of a `days` map. */
export const ukDay = (date) => { const c = ukClock(date); return `${c.y}-${String(c.m).padStart(2, "0")}-${String(c.d).padStart(2, "0")}`; };

/** Midnight starting `date`'s day in St Andrews, `days` days on (or back). */
export const dayStart = (date, days = 0) => { const c = ukClock(date); return ukTime(c.y, c.m, c.d + days); };

/** Days in a row with 30+ minutes. Today only counts once it's earned, and only breaks the streak once it's over. */
export function streakFrom(days = {}, now = new Date(), minimum = 30) {
  let day = dayStart(now);
  if ((days[ukDay(day)] || 0) < minimum) day = dayStart(day, -1);
  let streak = 0;
  while ((days[ukDay(day)] || 0) >= minimum && streak < 400) { streak++; day = dayStart(day, -1); }
  return streak;
}

/* Badges. Each comes from one of someone's records (private.badge_facts:
   their longest sitting, best day, best streak…), best-ever, so a bad week
   doesn't cost you one, but correcting a session can.
   `key` is the record and `goal` what it takes; `unit` says how to show the
   progress. A secret one shows as ??? until someone has it. */
export const BADGE_GROUPS = [
  ["grind", "The grind", "One sitting, no pause. Switching module doesn't stop the clock."],
  ["days", "Big days"],
  ["hours", "Milestones"],
  ["streaks", "Streaks", "Days in a row with 30+ minutes."],
  ["clock", "Odd hours"],
  ["calendar", "Days that count"],
  ["crew", "Crew"],
  ["secret", "Secret"],
];
const b = (group, id, icon, name, detail, key, goal, unit = "count", extra = {}) => ({ group, id, icon, name, detail, key, goal, unit, ...extra });
export const BADGES = [
  b("grind", "marathon", "🏃", "Marathon", "3 hours in one sitting", "longest_sitting", 180, "time"),
  b("grind", "iron", "🦾", "Iron Will", "5 hours in one sitting", "longest_sitting", 300, "time"),
  b("grind", "shift", "🧟", "The Full Shift", "8 hours in one sitting", "longest_sitting", 480, "time"),
  b("grind", "unit", "🌋", "Absolute Unit", "12 hours in one sitting", "longest_sitting", 720, "time"),

  b("days", "grindday", "📅", "Grind Day", "6 hours in one day", "best_day", 360, "time"),
  b("days", "lifer", "🐀", "Library Lifer", "10 hours in one day", "best_day", 600, "time"),
  b("days", "polymath", "🧠", "Polymath", "4 different modules in one day", "most_modules_day", 4),
  b("days", "weekend", "🛋️", "Weekend Warrior", "5 hours over one weekend", "best_weekend", 300, "time"),
  b("days", "warrior", "⚔️", "Week Warrior", "20 hours in one week", "best_week", 1200, "time"),
  b("days", "fulltime", "💼", "Full-Time Student", "40 hours in one week", "best_week", 2400, "time"),

  b("hours", "first", "🔐", "First Lock", "Finish your first session", "sessions", 1),
  b("hours", "ten", "⏳", "Ten Hours", "10 hours in total", "total_minutes", 600, "time"),
  b("hours", "fifty", "💎", "Fifty Club", "50 hours in total", "total_minutes", 3000, "time"),
  b("hours", "hundred", "🏛️", "Centurion", "100 hours in total", "total_minutes", 6000, "time"),
  b("hours", "royalty", "👑", "Royalty", "250 hours in total", "total_minutes", 15000, "time"),
  b("hours", "goat", "🐐", "The GOAT", "500 hours in total", "total_minutes", 30000, "time"),
  b("hours", "ascended", "🌌", "Ascended", "1,000 hours in total", "total_minutes", 60000, "time"),

  b("streaks", "hattrick", "🌱", "Hat Trick", "A 3-day streak", "best_streak", 3, "days"),
  b("streaks", "fire", "🔥", "On Fire", "A 7-day streak", "best_streak", 7, "days"),
  b("streaks", "unstoppable", "☄️", "Unstoppable", "A 14-day streak", "best_streak", 14, "days"),
  b("streaks", "habit", "🗓️", "Habit Formed", "A 30-day streak", "best_streak", 30, "days"),
  b("streaks", "comeback", "🦅", "Comeback Kid", "2 hours in a day, after a week off", "comebacks", 1),

  b("clock", "early", "🌅", "Early Bird", "Start 3 sessions before 8am", "early", 3),
  b("clock", "dawn", "🐓", "Dawn Patrol", "Start a session between 4 and 6am", "dawn", 1),
  b("clock", "night", "🦉", "Night Owl", "Start 3 sessions after 10pm", "late", 3),
  b("clock", "midnight", "🕯️", "Midnight Oil", "Study through midnight", "through_midnight", 1),
  b("clock", "3am", "👻", "3am Club", "Be locked in at 3am", "at_3am", 1),
  b("clock", "friday", "🪩", "Friday Night Lights", "Lock in on a Friday after 8pm", "friday_night", 1),

  b("calendar", "halloween", "🎃", "Spooky Scholar", "Study on Halloween", "halloween", 1),
  b("calendar", "christmas", "🎄", "Holiday Hustle", "Study on Christmas Day", "christmas", 1),
  b("calendar", "newyear", "🎆", "New Year, New Me", "Study on 1 January", "new_year", 1),
  b("calendar", "valentine", "💘", "Library Date", "Study on Valentine's Day", "valentines", 1),

  b("crew", "buddy", "👯", "Study Buddy", "10 sessions with a crewmate locked in alongside", "together", 10),
  b("crew", "party", "🥳", "Study Party", "Locked in with 2 crewmates at once", "most_alongside", 2),
  b("crew", "house", "🏟️", "Full House", "Locked in with 4 crewmates at once", "most_alongside", 4),
  b("crew", "champion", "🥇", "Champion", "Win a week on your crew's board", "weeks_won", 1),
  b("crew", "dynasty", "🏆", "Dynasty", "Win 3 weeks in a row", "best_win_run", 3),
  b("crew", "hype", "📣", "Hype Machine", "Send 25 hypes", "hypes_sent", 25),
  b("crew", "fan", "🌟", "Fan Favourite", "Get 25 hypes", "hypes_got", 25),

  b("secret", "answer", "🤖", "The Answer", "A session of exactly 42 minutes", "exactly_42", 1, "count", { secret: true, hint: "Life, the universe and everything" }),
  b("secret", "sevens", "🎰", "Lucky Sevens", "A session of exactly 77 minutes", "exactly_77", 1, "count", { secret: true, hint: "Feeling lucky?" }),
];

/** Every badge against someone's records: earned or not, and how far along. `facts.earned` is what the
    database has recorded. It withdraws a badge when a corrected session no longer supports it, but keeps
    crew badges, whose records can shrink just because someone left the crew. */
export const badgesFor = (facts = {}) => BADGES.map((badge) => {
  const value = Number(facts[badge.key]) || 0;
  const got = value >= badge.goal || (facts.earned || []).includes(badge.id);
  return { ...badge, value, got, ratio: got ? 1 : Math.min(1, value / badge.goal) };
});

/** "2h 10m / 5h", "4 / 10 days" — how far along a badge is, for the ones you count towards. */
export function badgeProgress(badge) {
  if (badge.got || badge.goal <= 1) return null;
  if (badge.unit === "time") return `${hm(badge.value)} / ${badge.goal % 60 ? hm(badge.goal) : `${(badge.goal / 60).toLocaleString("en-GB")}h`}`;
  return `${badge.value} / ${badge.goal}${badge.unit === "days" ? " days" : ""}`;
}

/* Records set in one go: a longer sitting, a bigger day. Studying some other time doesn't
   add to them, so there's no honest way to say how much is left. */
const ONE_GO = new Set(["longest_sitting", "best_day", "most_modules_day", "best_weekend", "best_week", "most_alongside", "best_win_run"]);

/** Would more of the same get you there? Not for a one-go record, nor for a streak longer than the one you're on. */
export const addsUp = (badge, streak = 0) => (badge.key === "best_streak" ? streak >= badge.value : !ONE_GO.has(badge.key));

/** The badges someone is closest to, for "next up": started, not secret, really within reach, nearest first. */
export const nextBadges = (badges, streak = 0, count = 3) =>
  badges.filter((badge) => !badge.got && !badge.secret && badge.ratio > 0 && badge.goal > 1 && addsUp(badge, streak)).sort((a, b) => b.ratio - a.ratio).slice(0, count);

/** "Luke", "Luke and Miguel", "Luke, Miguel and Connor". */
export const listNames = (names) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/** People locked in right now, in the groups they joined; someone on their own is a group of one. `groupOf` gives a person's key. */
export function studyGroups(people, groupOf) {
  const groups = new Map();
  for (const person of people) {
    const key = groupOf(person) || person.user_id;
    groups.set(key, [...(groups.get(key) || []), person]);
  }
  return [...groups.values()];
}

/** How long "I'm coming" is worth showing. A hype is nice to see whenever. */
export const ON_THE_WAY_MS = 60 * 60000;

/** Pings waiting to be seen: one line per person and kind, newest first. */
export function pingLines(pings = [], now = Date.now()) {
  const lines = new Map();
  for (const ping of pings) {
    if (ping.kind === "joining" && now - +new Date(ping.created_at) > ON_THE_WAY_MS) continue;
    const key = `${ping.from_user}:${ping.kind}`;
    const line = lines.get(key) || { from_user: ping.from_user, kind: ping.kind, count: 0, last: ping.created_at };
    line.count++;
    if (+new Date(ping.created_at) > +new Date(line.last)) line.last = ping.created_at;
    lines.set(key, line);
  }
  return [...lines.values()].sort((a, b) => +new Date(b.last) - +new Date(a.last));
}

/** This week's race, highest first. Ties go to whoever has the longer streak, then alphabetically. */
export function standings(people, key = "week_minutes", now = new Date()) {
  return [...people]
    .map((p) => ({ ...p, streak: streakFrom(p.days, now) }))
    .sort((a, b) => (b[key] - a[key]) || (b.streak - a.streak) || a.name.localeCompare(b.name))
    .map((p, i) => ({ ...p, rank: i + 1 }));
}

/** The one line that makes it a race: who you can catch, or how far ahead you are. `who` names you for someone watching. */
export function chaseLine(ranked, meId, key = "week_minutes", who = null) {
  const me = ranked.find((p) => p.user_id === meId);
  if (!me || ranked.length < 2) return null;
  if (me.rank === 1) {
    const second = ranked[1];
    const lead = me[key] - second[key];
    if (who) return lead > 0 ? `${who} is top — ${hm(lead)} clear of ${second.name}.` : `${who} is tied for first with ${second.name}.`;
    return lead > 0 ? `You're top — ${hm(lead)} clear of ${second.name}.` : `Tied for first with ${second.name}. One session settles it.`;
  }
  const ahead = ranked[me.rank - 2];
  const gap = ahead[key] - me[key] + 1;
  return `${hm(gap)} ${who ? `for ${who} ` : ""}to overtake ${ahead.name} for #${ahead.rank}.`;
}

/** Monday 00:00 of the week `date` falls in, St Andrews time — the board's week. */
export function weekStart(date) {
  const c = ukClock(date);
  return ukTime(c.y, c.m, c.d - c.weekday);
}

/** The last `count` weeks from daily minutes, oldest first. The last one is this week so far. */
export function weeksFrom(days = {}, now = new Date(), count = 10) {
  const thisWeek = weekStart(now);
  const weeks = [];
  for (let back = count - 1; back >= 0; back--) {
    const start = dayStart(thisWeek, -7 * back);
    let minutes = 0;
    for (let i = 0; i < 7; i++) minutes += days[ukDay(dayStart(start, i))] || 0;
    weeks.push({ start, minutes, current: back === 0 });
  }
  return weeks;
}

/** Minutes per subject for sessions that started in [from, to), most first. */
export function subjectsBetween(sessions = [], from, to) {
  const totals = new Map();
  for (const s of sessions) {
    const start = +new Date(s.started_at);
    if (start < +from || start >= +to) continue;
    totals.set(s.subject, (totals.get(s.subject) || 0) + (+new Date(s.ended_at) - start) / 60000);
  }
  return [...totals].map(([subject, minutes]) => ({ subject, minutes })).sort((a, b) => b.minutes - a.minutes);
}

/** Whole-hour gridlines, about three of them, for a chart whose tallest bar is `maxMinutes`. */
export function hourTicks(maxMinutes) {
  const hours = Math.max(1, Math.ceil(maxMinutes / 60));
  const step = hours <= 3 ? 1 : hours <= 6 ? 2 : hours <= 15 ? 5 : hours <= 30 ? 10 : 20;
  return { top: Math.ceil(hours / step) * step * 60, step: step * 60 };
}

/** "4.3h" — short enough to sit above a narrow bar. */
export const shortHours = (minutes) => `${(minutes / 60).toFixed(minutes < 600 ? 1 : 0)}h`;

/** "1h 05m", "45m", "0m" */
export function hm(minutes) {
  const m = Math.max(0, Math.round(minutes));
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
}

/* A sitting is one go at studying, broken up by pauses. Each stretch is saved
   as its own session when you pause; `banked_seconds` on the live row is what
   those stretches add up to, so the clock carries on after a break. */

/** How long your own break stays resumable; after that it's over. */
export const BREAK_KEPT_MS = 12 * 3600000;
/** How long crewmates see you "on a break"; after that you're just not studying. */
export const BREAK_SHOWN_MS = 3 * 3600000;

/** Time in this sitting: what's banked from before any breaks, plus the stretch running now. */
export const sittingMs = (row, now = Date.now()) =>
  (row?.banked_seconds || 0) * 1000 + (row?.started_at ? Math.max(0, now - +new Date(row.started_at)) : 0);

/** A live row that's on a break, and not one older than `limit`. */
export const onBreak = (row, limit, now = Date.now()) =>
  Boolean(row?.paused_at && !row.started_at && now - +new Date(row.paused_at) < limit);

/** How long a timer can run untouched before it asks "Still locked in?" and crewmates stop seeing it. Matches private.hidden_from. */
export const STILL_THERE_MS = 3 * 3600000;

/** When a running timer goes unconfirmed: 3 hours after its stretch started or its owner last said "still here". Null if nothing's running. */
export const hiddenFrom = (row) =>
  row?.started_at ? Math.max(+new Date(row.started_at), row.checked_at ? +new Date(row.checked_at) : 0) + STILL_THERE_MS : null;

/** A stretch long enough to look twice before saving it: a forgotten timer is how false records and badges happen. */
export const longStretch = (row, now = Date.now()) => Boolean(row?.started_at) && now - +new Date(row.started_at) >= STILL_THERE_MS;

/** A running timer that's waiting for its owner to say they're still there. */
export const unconfirmed = (row, now = Date.now()) => {
  const at = hiddenFrom(row);
  return at !== null && now >= at;
};

/** "1:02:09" for a running timer. */
export function clock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** Time until the board resets: midnight for the day's, Monday 00:00 for the week's (St Andrews time). */
export function untilReset(now = new Date(), period = "week") {
  const next = period === "day" ? dayStart(now, 1) : dayStart(weekStart(now), 7);
  const minutes = Math.round((+next - +now) / 60000);
  const days = Math.floor(minutes / 1440), hours = Math.floor((minutes % 1440) / 60);
  return days ? `${days}d ${hours}h` : `${hours}h ${minutes % 60}m`;
}

export function ago(iso, now = new Date()) {
  const minutes = Math.round((+now - +new Date(iso)) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

/** A linked app's connection as one pasteable code: project URL, publishable key and link key. */
export const encodeLinkCode = ({ url, key, link }) => btoa(JSON.stringify({ u: url, k: key, l: link })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/* Ranked. Beside your level (which only ever climbs) sits a tier that follows
   how much you study now: your average hours a week over the last four weeks.
   Study more and you're promoted; ease off and you drop. Someone who started
   under four weeks ago is averaged over the days they've had (at least a
   week's worth), not rounded up to whole weeks: rounding made a few days'
   head start cost a whole extra week of average. */
export const RANKED_WEEKS = 4;
export const TIERS = [
  ["bronze", "Bronze", 0], ["silver", "Silver", 3], ["gold", "Gold", 6], ["platinum", "Platinum", 10],
  ["diamond", "Diamond", 15], ["master", "Master", 20], ["titan", "Titan", 27], ["mythic", "Mythic", 35],
].map(([id, name, hours], index) => ({ id, name, hours, index, minutes: hours * 60 }));

const dayNumber = (key) => { const [y, m, d] = key.split("-").map(Number); return Date.UTC(y, m - 1, d) / 86400000; };

/** Someone's tier from their daily minutes (`days`, as room_stats gives them). `tier` is null until they've
    studied in the window; `toNext` is how much more study, in minutes, lifts the average to the next tier. */
export function rankedFor(days = {}, now = new Date()) {
  const today = dayNumber(ukDay(now));
  let total = 0, first = null;
  for (const [key, minutes] of Object.entries(days)) {
    const day = dayNumber(key);
    if (!(minutes > 0) || day > today) continue;
    if (first === null || day < first) first = day;
    if (day > today - RANKED_WEEKS * 7) total += minutes;
  }
  const span = first === null ? 7 : Math.min(RANKED_WEEKS * 7, Math.max(7, today - first + 1));
  const weeks = span / 7;
  const average = total / weeks;
  const tier = total ? TIERS.findLast((t) => average >= t.minutes) : null;
  const next = tier ? TIERS[tier.index + 1] || null : TIERS[0];
  const from = tier ? tier.minutes : 0;
  return {
    tier, next, days: span, weeks, total, average,
    toNext: !tier ? 1 : next ? Math.max(1, Math.ceil(next.minutes * weeks - total)) : 0,
    ratio: tier && next ? Math.min(1, (average - from) / (next.minutes - from)) : tier ? 1 : 0,
  };
}

/** "12.4h" — an average week, for "12.4h a week". */
export const weekHours = (minutes) => `${(minutes / 60).toFixed(1).replace(/\.0$/, "")}h`;

/** What a change of tier is: "up", "down" or null. `before` and `after` are tier indexes, -1 for unranked. */
export const tierMove = (before, after) => (after > before ? "up" : after < before ? "down" : null);

/* Coins and the shop. Ten coins an hour, worked out by the database from saved
   sessions (private.coins_of), and spent on things to wear or on gifts for a
   crewmate. `id`, `kind` and `price` mirror private.shop_items. */
export const COINS_PER_HOUR = 10;
export const SHOP_KINDS = [["frame", "Avatar frames"], ["color", "Name colours"], ["tag", "Tags"], ["treat", "Treats"]];
const item = (id, kind, price, name, icon = null) => ({ id, kind, price, name, icon });
export const SHOP = [
  item("ember", "frame", 120, "Ember"),
  item("frost", "frame", 120, "Frost"),
  item("neon", "frame", 180, "Neon"),
  item("royal", "frame", 250, "Royal"),
  item("prism", "frame", 350, "Prism"),
  item("coral", "color", 60, "Coral"),
  item("ocean", "color", 60, "Ocean"),
  item("mint", "color", 60, "Mint"),
  item("grape", "color", 60, "Grape"),
  item("sunset", "color", 150, "Sunset"),
  item("aurora", "color", 200, "Aurora"),
  item("coffee-run", "tag", 40, "Runs on coffee", "☕"),
  item("night-shift", "tag", 40, "Night shift", "🌙"),
  item("bookworm", "tag", 40, "Bookworm", "📖"),
  item("zen", "tag", 60, "Zen mode", "🧘"),
  item("built-different", "tag", 80, "Built different", "🚀"),
  item("main-character", "tag", 120, "Main character", "👑"),
  item("coffee", "treat", 10, "Coffee", "☕"),
  item("cookie", "treat", 10, "Cookie", "🍪"),
  item("pizza", "treat", 20, "Pizza", "🍕"),
  item("energy", "treat", 20, "Energy drink", "⚡️"),
  item("rose", "treat", 30, "Rose", "🌹"),
  item("trophy", "treat", 50, "Trophy", "🏆"),
];
export const shopItem = (id) => SHOP.find((x) => x.id === id) || null;

/** What a message can be given in the chat; the database keeps the key (public.reactions.kind). */
export const REACTIONS = [["heart", "❤️"], ["fire", "🔥"], ["laugh", "😂"], ["clap", "👏"], ["strong", "💪"], ["wow", "😮"]];
/** What someone watching can send (public.watch_cheers.kind). */
export const CHEERS = [["heart", "❤️"], ["clap", "👏"], ["strong", "💪"], ["fire", "🔥"], ["star", "⭐️"]];

/** A message's reactions as chips: one per kind in REACTIONS' order, with how many and whether one is yours. */
export function reactionChips(reactions = [], meId = null) {
  return REACTIONS.map(([kind, emoji]) => {
    const of = reactions.filter((r) => r.kind === kind);
    return { kind, emoji, count: of.length, mine: of.some((r) => r.user_id === meId), who: of.map((r) => r.user_id) };
  }).filter((chip) => chip.count);
}

/** Things waiting to be seen that aren't pings: gifts and watchers' cheers, one line per sender and thing.
    A cheer with a note keeps its own line, so the note is read. `key(row)` names the group; newest first. */
export function groupedLines(rows = [], key) {
  const lines = new Map();
  for (const row of rows) {
    const k = key(row);
    const line = lines.get(k) || { ...row, count: 0, last: row.created_at };
    line.count++;
    if (+new Date(row.created_at) > +new Date(line.last)) line.last = row.created_at;
    lines.set(k, line);
  }
  return [...lines.values()].sort((a, b) => +new Date(b.last) - +new Date(a.last));
}
