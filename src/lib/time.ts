/** Formatting and date helpers shared by server and client. */

export function fmtClock(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export function fmtHM(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

export function fmtHours(seconds: number) {
  const totalMinutes = Math.max(0, Math.round(seconds / 60));
  if (totalMinutes === 0) return "0h";
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  return m ? `${h}h ${String(m).padStart(2, "0")}m` : `${h}h`;
}

export function hoursDecimal(seconds: number) {
  return Math.round((seconds / 3600) * 100) / 100;
}

// Formatting preferences, set from the browser's saved prefs (see lib/prefs.ts). These are
// only the defaults: every function that depends on them also takes the setting as an
// explicit argument, so tests and other callers never depend on hidden state (R-054).
let hour12: boolean | undefined;
let weekStartsSunday = false;
export function setTimeFormat(f: "12h" | "24h") {
  hour12 = f === "12h";
}
export function setWeekStart(d: "monday" | "sunday") {
  weekStartsSunday = d === "sunday";
}
export type WeekStart = "monday" | "sunday";
const currentWeekStart = (): WeekStart => (weekStartsSunday ? "sunday" : "monday");

// ---------------------------------------------------------------------------------------
// Workspace time zone (D-012). Every person sees and enters time in the workspace zone
// (default Asia/Karachi), whatever their computer is set to.
//
// Convention in client code:
// - ISO strings from the server are exact instants.
// - `Date` objects in UI code are *wall-clock dates*: their local fields (getHours, getDate…)
//   are the time in the workspace zone. `toZoned()` makes one from an instant,
//   `fromZoned()` turns one back into the real instant before it is sent to the server,
//   and `zonedNow()` replaces `new Date()` for "now".
// So existing local-date arithmetic (startOfDay, addDays, …) works unchanged in the zone.
// Without a zone set (server code, tests) both conversions are identity.
// ---------------------------------------------------------------------------------------
let zone: string | null = null;
const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

/** Set the workspace zone for this browser session (called by the app shell). */
export function setTimeZone(tz: string | null) {
  zone = tz && isValidTimeZone(tz) ? tz : null;
}
/** The zone times are shown in: the workspace zone, or the browser's own before it is known. */
export function currentTimeZone() {
  if (zone) return zone;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
export function isValidTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Offset of `tz` from UTC at an instant, in ms (PKT: +5 h). */
export function zoneOffsetMs(instantMs: number, tz: string) {
  let f = offsetFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
    offsetFormatters.set(tz, f);
  }
  const p: Record<string, number> = {};
  for (const part of f.formatToParts(new Date(instantMs))) if (part.type !== "literal") p[part.type] = Number(part.value);
  const wall = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour! % 24, p.minute!, p.second!);
  return wall - Math.floor(instantMs / 1000) * 1000;
}

/** Instant (ISO string or real Date) → wall-clock Date in the workspace zone. */
export function toZoned(d: Date | string | number): Date {
  const t = typeof d === "string" ? Date.parse(d) : typeof d === "number" ? d : d.getTime();
  if (!zone) return new Date(t);
  const w = new Date(t + zoneOffsetMs(t, zone));
  return new Date(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate(), w.getUTCHours(), w.getUTCMinutes(), w.getUTCSeconds(), w.getUTCMilliseconds());
}

/** Wall-clock Date in the workspace zone → the real instant. */
export function fromZoned(local: Date): Date {
  if (!zone) return new Date(local.getTime());
  const wall = Date.UTC(local.getFullYear(), local.getMonth(), local.getDate(), local.getHours(), local.getMinutes(), local.getSeconds(), local.getMilliseconds());
  let t = wall - zoneOffsetMs(wall, zone);
  t = wall - zoneOffsetMs(t, zone); // second pass settles DST transitions
  return new Date(t);
}

/** Wall-clock Date in the workspace zone → ISO instant string for the server. */
export function toISO(wall: Date) {
  return fromZoned(wall).toISOString();
}

/** "Now" as a wall-clock Date in the workspace zone. */
export function zonedNow() {
  return toZoned(Date.now());
}

/** A Date argument is already a wall-clock date; a string is an instant from the server. */
const wallDate = (d: Date | string) => (typeof d === "string" ? toZoned(d) : d);

/** Short label for an hour of the day on a calendar axis: "8 AM" / "08:00". */
export function hourLabel(h: number, twelve: boolean = hour12 ?? !/^(en-GB|de|fr|es|it|nl|pl|pt|ru|sv|da|fi|nb|tr|cs|hu|ro|uk|ur|hi)/.test(typeof navigator !== "undefined" ? navigator.language : "en-US")) {
  if (!twelve) return `${String(h).padStart(2, "0")}:00`;
  const hr = h % 12 || 12;
  return `${hr} ${h < 12 ? "AM" : "PM"}`;
}

export function fmtTime(d: Date | string, twelve: boolean | undefined = hour12) {
  const date = wallDate(d);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: twelve });
}

export function fmtDate(d: Date | string, opts: Intl.DateTimeFormatOptions = {}) {
  const date = wallDate(d);
  return date.toLocaleDateString([], { month: "short", day: "numeric", ...opts });
}

/** Local calendar key YYYY-MM-DD. */
export function dayKey(d: Date | string) {
  const date = wallDate(d);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Start of the week (Monday by default, Sunday if preferred). */
export function startOfWeek(d: Date, weekStart: WeekStart = currentWeekStart()) {
  const x = startOfDay(d);
  const day = weekStart === "sunday" ? x.getDay() : (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  return x;
}

export function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function dayLabel(key: string, now: Date = zonedNow()) {
  const today = dayKey(now);
  const yesterday = dayKey(addDays(now, -1));
  const date = new Date(key + "T00:00:00");
  const long = date.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
  if (key === today) return `Today · ${long}`;
  if (key === yesterday) return `Yesterday · ${long}`;
  return long;
}

/** Value for a datetime-local input, in local time. */
export function toLocalInput(d: Date | string) {
  const date = wallDate(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Days from the inclusive key range. */
export function daysInRange(from: string, to: string) {
  const a = new Date(from + "T00:00:00");
  const b = new Date(to + "T00:00:00");
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / 86400000) + 1);
}

export type PeriodKey =
  | "today"
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "last_30"
  | "last_90"
  | "this_year"
  | "custom";

export const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "this_week", label: "This week" },
  { key: "last_week", label: "Last week" },
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "last_30", label: "Last 30 days" },
  { key: "last_90", label: "Last 90 days" },
  { key: "this_year", label: "This year" },
  { key: "custom", label: "Custom range" },
];

/** Inclusive [from, to] day keys for a period. */
export function periodRange(key: PeriodKey, now = zonedNow(), weekStart: WeekStart = currentWeekStart()): { from: string; to: string } {
  const today = startOfDay(now);
  switch (key) {
    case "today":
      return { from: dayKey(today), to: dayKey(today) };
    case "this_week":
      return { from: dayKey(startOfWeek(today, weekStart)), to: dayKey(today) };
    case "last_week": {
      const s = addDays(startOfWeek(today, weekStart), -7);
      return { from: dayKey(s), to: dayKey(addDays(s, 6)) };
    }
    case "this_month":
      return { from: dayKey(startOfMonth(today)), to: dayKey(today) };
    case "last_month": {
      const s = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const e = new Date(today.getFullYear(), today.getMonth(), 0);
      return { from: dayKey(s), to: dayKey(e) };
    }
    case "last_30":
      return { from: dayKey(addDays(today, -29)), to: dayKey(today) };
    case "last_90":
      return { from: dayKey(addDays(today, -89)), to: dayKey(today) };
    case "this_year":
      return { from: dayKey(new Date(today.getFullYear(), 0, 1)), to: dayKey(today) };
    default:
      return { from: dayKey(addDays(today, -29)), to: dayKey(today) };
  }
}

export const PROJECT_COLORS = [
  "#0d9488", "#2563eb", "#7c3aed", "#db2777", "#ea580c", "#ca8a04",
  "#16a34a", "#0891b2", "#4f46e5", "#e11d48", "#65a30d", "#475569",
];

/** "HH:MM" (24h) for a time-of-day text field. */
export function fmtTimeText(d: Date | string) {
  const date = wallDate(d);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/**
 * Parse a typed time such as "9", "9:30", "09.30", "930", "9:30pm" or "14:05".
 * Returns hours/minutes, or null when it can't be read.
 */
export function parseTimeText(input: string): { h: number; m: number } | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  const ampm = /(a|p)m?$/.exec(s)?.[1];
  const digits = s.replace(/(a|p)m?$/, "").replace(/[^\d:.]/g, "");
  let h: number;
  let m: number;
  if (/^\d{1,2}[:.]\d{1,2}$/.test(digits)) {
    const [a, b] = digits.split(/[:.]/);
    h = Number(a);
    m = Number(b);
  } else if (/^\d{3,4}$/.test(digits)) {
    h = Number(digits.slice(0, digits.length - 2));
    m = Number(digits.slice(-2));
  } else if (/^\d{1,2}$/.test(digits)) {
    h = Number(digits);
    m = 0;
  } else {
    return null;
  }
  if (ampm === "p" && h < 12) h += 12;
  if (ampm === "a" && h === 12) h = 0;
  if (h > 23 || m > 59) return null;
  return { h, m };
}

/** Local Date for a YYYY-MM-DD key plus hours/minutes. */
export function combineDateTime(key: string, t: { h: number; m: number }) {
  const [y, mo, d] = key.split("-").map(Number);
  return new Date(y!, mo! - 1, d!, t.h, t.m, 0, 0);
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}
