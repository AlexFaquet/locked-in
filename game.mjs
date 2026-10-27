// The game: levels, streaks, badges and the race. Pure functions over the
// stats the database returns (room_stats), so they're easy to test.

/** XP is minutes studied. Each level needs more than the last: L2 at 2.5h, L3 at 10h, L5 at 40h, L10 at 202.5h. */
export const levelFor = (minutes) => Math.floor(Math.sqrt(Math.max(0, minutes) / 60 / 2.5)) + 1;
export const minutesForLevel = (level) => Math.round(2.5 * (level - 1) ** 2 * 60);

const TITLES = ["Fresh Starter", "Note Taker", "Library Regular", "Focus Apprentice", "Deep Worker", "Study Machine", "Exam Slayer", "Scholar", "Grandmaster", "Legend"];
export const titleFor = (level) => TITLES[Math.min(level, TITLES.length) - 1];

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

export const BADGES = [
  { id: "first", icon: "🔐", name: "First Lock", detail: "Finish your first session", earned: (s) => s.session_count >= 1 },
  { id: "early", icon: "🌅", name: "Early Bird", detail: "Start 3 sessions before 8am", earned: (s) => s.early_sessions >= 3 },
  { id: "night", icon: "🦉", name: "Night Owl", detail: "Start 3 sessions after 10pm", earned: (s) => s.late_sessions >= 3 },
  { id: "marathon", icon: "🏃", name: "Marathon", detail: "One session of 3 hours", earned: (s) => s.longest_minutes >= 180 },
  { id: "fire", icon: "🔥", name: "On Fire", detail: "A 7-day streak", earned: (s, streak) => streak >= 7 },
  { id: "ten", icon: "⏳", name: "Ten Hours", detail: "10 hours in total", earned: (s) => s.total_minutes >= 600 },
  { id: "warrior", icon: "⚔️", name: "Week Warrior", detail: "20 hours in one week", earned: (s) => s.week_minutes >= 1200 },
  { id: "fifty", icon: "💎", name: "Fifty Club", detail: "50 hours in total", earned: (s) => s.total_minutes >= 3000 },
  { id: "hundred", icon: "🏛️", name: "Centurion", detail: "100 hours in total", earned: (s) => s.total_minutes >= 6000 },
];
export const badgesFor = (stats, streak) => BADGES.map((badge) => ({ ...badge, got: Boolean(badge.earned(stats, streak)) }));

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
