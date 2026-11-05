"use client";

import { setTimeFormat, setWeekStart } from "./time";

/**
 * Per-device preferences, kept in localStorage. They shape how the app
 * behaves for this person on this browser; nothing here is sent to the server.
 */
export type Prefs = {
  /** Which mode the time tracker opens in. */
  defaultMode: "timer" | "manual";
  /** How many days the time tracker lists by default. */
  trackerWindow: "7" | "14" | "30";
  /** Clock format for times in lists. */
  timeFormat: "12h" | "24h";
  /** Which day the week starts on in charts and "this week" totals. */
  weekStart: "monday" | "sunday";
  /** Tick the browser tab title while a timer runs. */
  tickingTitle: boolean;
  /** Warn when a timer has been running longer than this many hours (0 = never). */
  longTimerHours: number;
};

export const DEFAULT_PREFS: Prefs = {
  defaultMode: "timer",
  trackerWindow: "7",
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
