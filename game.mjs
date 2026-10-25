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

export const localDay = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const dayBefore = (date) => { const d = new Date(date); d.setDate(d.getDate() - 1); return d; };

/** Days in a row with 30+ minutes. Today only counts once it's earned, and only breaks the streak once it's over. */
export function streakFrom(days = {}, now = new Date(), minimum = 30) {
  let day = new Date(now);
  if ((days[localDay(day)] || 0) < minimum) day = dayBefore(day);
  let streak = 0;
  while ((days[localDay(day)] || 0) >= minimum && streak < 400) { streak++; day = dayBefore(day); }
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

/** The one line that makes it a race: who you can catch, or how far ahead you are. */
export function chaseLine(ranked, meId, key = "week_minutes") {
  const me = ranked.find((p) => p.user_id === meId);
  if (!me || ranked.length < 2) return null;
  if (me.rank === 1) {
    const second = ranked[1];
    const lead = me[key] - second[key];
    return lead > 0 ? `You're top — ${hm(lead)} clear of ${second.name}.` : `Tied for first with ${second.name}. One session settles it.`;
  }
  const ahead = ranked[me.rank - 2];
  const gap = ahead[key] - me[key] + 1;
  return `${hm(gap)} to overtake ${ahead.name} for #${ahead.rank}.`;
}

/** "1h 05m", "45m", "0m" */
export function hm(minutes) {
  const m = Math.max(0, Math.round(minutes));
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
}

/** "1:02:09" for a running timer. */
export function clock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** Time until the weekly board resets, Monday 00:00 local. */
export function untilReset(now = new Date()) {
  const next = new Date(now);
  next.setHours(0, 0, 0, 0);
  next.setDate(next.getDate() + ((8 - next.getDay()) % 7 || 7));
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
