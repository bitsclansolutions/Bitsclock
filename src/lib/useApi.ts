"use client";

import { useCallback, useEffect, useState } from "react";
import { api, errMsg, onMutation } from "./client";

/**
 * Stale-while-revalidate data hook for the app's GET endpoints.
 *
 * - The last response for a URL is kept in memory and in sessionStorage, so a
 *   page renders instantly with the previous data and refreshes in the
 *   background.
 * - Mutations call `invalidate("/api/time-entries", "/api/dashboard")` to drop
 *   cached responses by URL prefix; every mounted hook for those URLs refetches.
 */

type Cached = { data: unknown; time: number };

const mem = new Map<string, Cached>();
const listeners = new Set<(prefixes: string[]) => void>();
const STORAGE_PREFIX = "bc:cache:";
/**
 * When each URL prefix was last invalidated. A URL whose last network fetch is older than a
 * matching invalidation must bypass the browser HTTP cache (its copy may predate the change).
 * Kept per URL by time, so every page under the prefix gets fresh data, not just the first.
 */
const invalidatedAt = new Map<string, number>();
const fetchedAt = new Map<string, number>();
/** Longest time the browser may reuse an API response (max-age + stale-while-revalidate, with margin). */
const BROWSER_CACHE_MAX_MS = 5 * 60_000;

function mustBypass(url: string) {
  const last = fetchedAt.get(url) ?? 0;
  const now = Date.now();
  for (const [prefix, at] of invalidatedAt) {
    if (now - at > BROWSER_CACHE_MAX_MS) invalidatedAt.delete(prefix);
    else if (at > last && url.startsWith(prefix)) return true;
  }
  return false;
}

function readStorage(key: string): Cached | undefined {
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return undefined;
    return JSON.parse(raw) as Cached;
  } catch {
    return undefined;
  }
}

function getCached<T>(key: string): { data: T; time: number } | undefined {
  const m = mem.get(key);
  if (m) return m as { data: T; time: number };
  const s = readStorage(key);
  if (s) {
    mem.set(key, s);
    return s as { data: T; time: number };
  }
  return undefined;
}

function setCached(key: string, data: unknown) {
  const entry = { data, time: Date.now() };
  mem.set(key, entry);
  try {
    sessionStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(entry));
  } catch {
    /* storage may be full or blocked; memory cache still works */
  }
}

/** Drop cached responses whose URL starts with any prefix, refetch mounted hooks, and tell the other tabs. */
export function invalidate(...prefixes: string[]) {
  invalidateLocal(prefixes);
  try {
    channel?.postMessage({ type: "invalidate", prefixes });
  } catch {
    /* ignore */
  }
}

function invalidateLocal(prefixes: string[]) {
  const now = Date.now();
  for (const p of prefixes) invalidatedAt.set(p, now);
  for (const key of [...mem.keys()]) {
    if (prefixes.some((p) => key.startsWith(p))) mem.delete(key);
  }
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(STORAGE_PREFIX) && prefixes.some((p) => k.slice(STORAGE_PREFIX.length).startsWith(p))) sessionStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l(prefixes));
}

/** Subscribe to invalidations (local, from other tabs, or from the change feed). Returns an unsubscribe. */
export function onInvalidate(listener: (prefixes: string[]) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Prefetch a URL into the cache (e.g. lists needed by the next page). */
export function prefetch(url: string) {
  const bypass = mustBypass(url);
  if (getCached(url) && !bypass) return;
  const requestedAt = Date.now();
  api<unknown>(url, bypass ? { cache: "reload" } : {})
    .then((d) => {
      fetchedAt.set(url, requestedAt);
      setCached(url, d);
    })
    .catch(() => {});
}

/** Put a response into the cache under a URL, e.g. from a bulk bootstrap call. */
export function seed(url: string, data: unknown) {
  setCached(url, data);
}

// Other tabs of this browser hear about changes at once.
const channel: BroadcastChannel | null = typeof window !== "undefined" && "BroadcastChannel" in window ? new BroadcastChannel("bc:changes") : null;

if (typeof window !== "undefined") {
  // Back online after a drop: every mounted hook refetches, bypassing the browser cache.
  window.addEventListener("online", () => invalidateLocal(["/api"]));
  channel?.addEventListener("message", (e: MessageEvent<{ type?: string; prefixes?: unknown }>) => {
    if (e.data?.type === "invalidate" && Array.isArray(e.data.prefixes)) invalidateLocal(e.data.prefixes.filter((p): p is string => typeof p === "string" && p.startsWith("/api")));
  });
  // Every successful change (an entry added, a timer stopped, a project renamed…) can affect
  // any list or total in the app, so everything cached is refreshed: what's on screen now,
  // and every other page the next time it opens. Session-list calls are excluded (own cache).
  onMutation((path) => {
    if (path.startsWith("/api/auth/refresh")) return;
    lastLocalChangeAt = Date.now();
    invalidate("/api");
  });
}

let lastLocalChangeAt = 0;
const CHANGE_POLL_MS = 10_000;

/**
 * Changes made by other people or on other devices: polls /api/changes (a token, no data)
 * every 10 s while the tab is visible, and at once when the tab comes back into view.
 * When the token moves, everything cached is refreshed. Mounted once, by the app shell.
 */
export function useLiveUpdates() {
  useEffect(() => {
    let token: string | null = null;
    let checkedAt = 0;
    let busy = false;
    const check = async () => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      const started = Date.now();
      try {
        const res = await api<{ token: string }>("/api/changes", { cache: "no-store", retry: false });
        // Our own change already refreshed everything; just adopt the new token.
        const ownChange = lastLocalChangeAt >= checkedAt;
        if (token !== null && res.token !== token && !ownChange) invalidate("/api");
        token = res.token;
        checkedAt = started;
      } catch {
        /* offline or signed out: the next check will tell */
      } finally {
        busy = false;
      }
    };
    void check();
    const timer = window.setInterval(check, CHANGE_POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && void check();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);
}

type State<T> = { data?: T; error?: string; loading: boolean; stale: boolean };

export function useApi<T>(url: string | null, opts: { ttlMs?: number; enabled?: boolean } = {}) {
  const { ttlMs = 15_000, enabled = true } = opts;
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<State<T>>({ loading: !!url && enabled, stale: false });

  useEffect(() => {
    const l = (prefixes: string[]) => {
      if (url && prefixes.some((p) => url.startsWith(p))) setTick((t) => t + 1);
    };
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, [url]);

  useEffect(() => {
    if (!url || !enabled) return;
    let alive = true;
    const c = getCached<T>(url);
    const bypass = mustBypass(url);
    const fresh = !!c && !bypass && Date.now() - c.time < ttlMs;
    // Show whatever we have immediately; revalidate unless it is fresh.
    setState((s) => (c ? { data: c.data, error: undefined, loading: false, stale: !fresh } : { ...s, loading: s.data === undefined, stale: false }));
    if (fresh) return;
    // After a change the browser's cached copy may be older than it: go to the server.
    // (cache: "reload" also sends Cache-Control: no-cache, which makes the server re-read its cache versions.)
    const requestedAt = Date.now();
    api<T>(url, bypass ? { cache: "reload" } : {})
      .then((d) => {
        fetchedAt.set(url, requestedAt);
        setCached(url, d);
        if (alive) setState({ data: d, loading: false, stale: false });
      })
      .catch((e) => {
        if (alive) setState((s) => ({ ...s, error: errMsg(e), loading: false, stale: false }));
      });
    return () => {
      alive = false;
    };
  }, [url, enabled, ttlMs, tick]);

  const refresh = useCallback(() => {
    if (url) mem.delete(url);
    setTick((t) => t + 1);
  }, [url]);

  const mutate = useCallback(
    (data: T) => {
      if (url) setCached(url, data);
      setState({ data, loading: false, stale: false });
    },
    [url],
  );

  return { ...state, refresh, mutate };
}
