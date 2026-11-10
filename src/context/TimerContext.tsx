"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client";
import { onInvalidate } from "@/lib/useApi";
import { readPrefs } from "@/lib/prefs";
import type { EntryDTO } from "@/lib/entries";

type Ctx = {
  active: EntryDTO | null;
  elapsed: number; // seconds
  loading: boolean;
  refresh: () => Promise<void>;
  start: (data: { description: string; projectId: string | null; billable?: boolean }) => Promise<EntryDTO>;
  stop: () => Promise<EntryDTO | null>;
  setActive: (e: EntryDTO | null) => void;
};

const TimerCtx = createContext<Ctx | null>(null);

/**
 * Running-timer state is event driven, not polled:
 * - loaded from localStorage instantly, and from the server once per browser session;
 * - changed only by start / stop / edit, which also broadcast to other open tabs;
 * - re-checked against the server only if a stop is rejected (stopped elsewhere).
 */
const STORAGE_KEY = "bc:timer:active";
const CHECKED_KEY = "bc:timer:checked";
const CHANNEL = "bc:timer";

function readStored(): EntryDTO | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as EntryDTO) : null;
  } catch {
    return null;
  }
}

function writeStored(e: EntryDTO | null) {
  try {
    if (e) localStorage.setItem(STORAGE_KEY, JSON.stringify(e));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function TimerProvider({ children, enabled = true }: { children: React.ReactNode; enabled?: boolean }) {
  const [active, setActiveState] = useState<EntryDTO | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [loading, setLoading] = useState(enabled);
  const activeRef = useRef<EntryDTO | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  /** Update state, persist it, and tell other tabs. */
  const setActive = useCallback((e: EntryDTO | null, broadcast = true) => {
    setActiveState(e);
    writeStored(e);
    if (broadcast) channel.current?.postMessage({ type: "set", entry: e });
  }, []);

  /** One server check (used on first load per session, and after a rejected stop). */
  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const { entry } = await api<{ entry: EntryDTO | null }>("/api/time-entries/active", { cache: "no-store" });
      setActive(entry);
      try {
        sessionStorage.setItem(CHECKED_KEY, "1");
      } catch {
        /* ignore */
      }
    } catch (e) {
      console.warn("Timer refresh failed:", e instanceof Error ? e.message : e);
    } finally {
      setLoading(false);
    }
  }, [enabled, setActive]);

  // A timer started or stopped on another device (seen by the change feed) or any entry
  // change: re-check the running timer so the header pill is never out of date.
  useEffect(() => {
    if (!enabled) return;
    let t: number | undefined;
    const off = onInvalidate((prefixes) => {
      if (!prefixes.some((p) => "/api/time-entries/active".startsWith(p))) return;
      window.clearTimeout(t);
      t = window.setTimeout(() => void refresh(), 50); // several invalidations in a row → one check
    });
    return () => {
      off();
      window.clearTimeout(t);
    };
  }, [enabled, refresh]);

  // Initial load: storage first, then one server check per session.
  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    const stored = readStored();
    if (stored) {
      setActiveState(stored);
      activeRef.current = stored;
    }
    let checked = false;
    try {
      checked = sessionStorage.getItem(CHECKED_KEY) === "1";
    } catch {
      /* ignore */
    }
    if (checked) setLoading(false);
    else void refresh();
  }, [enabled, refresh]);

  // Cross-tab sync: a start/stop in another tab updates this one without a request.
  useEffect(() => {
    if (!enabled || typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(CHANNEL);
    channel.current = ch;
    ch.onmessage = (ev: MessageEvent<{ type: "set"; entry: EntryDTO | null }>) => {
      if (ev.data?.type === "set") setActive(ev.data.entry, false);
    };
    return () => {
      ch.close();
      channel.current = null;
    };
  }, [enabled, setActive]);

  // Elapsed ticker (local, no requests).
  useEffect(() => {
    if (!active) {
      setElapsed(0);
      return;
    }
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - new Date(active.startTime).getTime()) / 1000)));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [active]);

  // Tab title ticker (optional preference).
  useEffect(() => {
    const strip = (t: string) => t.replace(/^\d{2}:\d{2}:\d{2} · /, "");
    if (!active || !readPrefs().tickingTitle) {
      document.title = strip(document.title);
      return;
    }
    const h = Math.floor(elapsed / 3600);
    const m = Math.floor((elapsed % 3600) / 60);
    const s = elapsed % 60;
    document.title = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")} · ${strip(document.title) || "Bitsclock"}`;
  }, [elapsed, active]);

  const start = useCallback(
    async (data: { description: string; projectId: string | null; billable?: boolean }) => {
      const { entry } = await api<{ entry: EntryDTO }>("/api/time-entries/start", { method: "POST", json: data });
      setActive(entry);
      return entry;
    },
    [setActive],
  );

  const stop = useCallback(async () => {
    const cur = activeRef.current;
    if (!cur) return null;
    try {
      const { entry } = await api<{ entry: EntryDTO }>(`/api/time-entries/${cur.id}/stop`, { method: "POST" });
      setActive(null);
      return entry;
    } catch (e) {
      // Already stopped or deleted elsewhere: resync once from the server, then rethrow.
      const msg = e instanceof Error ? e.message : "";
      if (/already been stopped|not found/i.test(msg)) {
        await refresh();
        return null;
      }
      throw e;
    }
  }, [setActive, refresh]);

  const value = useMemo<Ctx>(() => ({ active, elapsed, loading, refresh, start, stop, setActive }), [active, elapsed, loading, refresh, start, stop, setActive]);
  return <TimerCtx.Provider value={value}>{children}</TimerCtx.Provider>;
}

export function useTimer() {
  const ctx = useContext(TimerCtx);
  if (!ctx) throw new Error("useTimer must be used inside TimerProvider");
  return ctx;
}
