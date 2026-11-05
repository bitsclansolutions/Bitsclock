"use client";

import { setTimeFormat, setWeekStart } from "./time";

/**
 * Per-device preferences, kept in localStorage. They shape how the app
 * behaves for this person on this browser; nothing here is sent to the server.
 */
export type Prefs = {
  /** Which mode the time tracker opens in. */
  defaultMode: "timer" | "manual";
  /** How far back the time tracker lists by default. */
  trackerWindow: TrackerWindow;
  /** Tracker list: load more as you scroll, or numbered pages. */
  trackerLoading: "scroll" | "pages";
  /** Rows per page when trackerLoading is "pages". */
  trackerPageSize: TrackerPageSize;
  /** Clock format for times in lists. */
  timeFormat: "12h" | "24h";
  /** Which day the week starts on in charts and "this week" totals. */
  weekStart: "monday" | "sunday";
  /** Tick the browser tab title while a timer runs. */
  tickingTitle: boolean;
  /** Warn when a timer has been running longer than this many hours (0 = never). */
  longTimerHours: number;
};

export type TrackerWindow = "7" | "14" | "30" | "90" | "year" | "all";
export const TRACKER_WINDOWS: { value: TrackerWindow; label: string }[] = [
  { value: "7", label: "Last 7 days" },
  { value: "14", label: "Last 14 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "year", label: "This year" },
  { value: "all", label: "All time" },
];
export type TrackerPageSize = "10" | "25" | "50" | "100";
export const TRACKER_PAGE_SIZES: TrackerPageSize[] = ["10", "25", "50", "100"];

export const DEFAULT_PREFS: Prefs = {
  defaultMode: "timer",
  trackerWindow: "7",
  trackerLoading: "scroll",
  trackerPageSize: "25",
  timeFormat: "24h",
  weekStart: "monday",
  tickingTitle: true,
  longTimerHours: 8,
};

const KEY = "bc:prefs";

export function readPrefs(): Prefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    return DEFAULT_PREFS;
  }
}

/** Push the formatting-related preferences into the shared time helpers. */
export function applyPrefs(p: Prefs = readPrefs()) {
  setTimeFormat(p.timeFormat);
  setWeekStart(p.weekStart);
  return p;
}

export function writePrefs(patch: Partial<Prefs>): Prefs {
  const next = { ...readPrefs(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage blocked */
  }
  applyPrefs(next);
  window.dispatchEvent(new CustomEvent("bc:prefs"));
  return next;
}
