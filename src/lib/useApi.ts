"use client";

import { useCallback, useEffect, useState } from "react";
import { api, errMsg } from "./client";

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
/** URL prefixes whose next fetch must bypass the browser HTTP cache (set by invalidate). */
const bypassPrefixes = new Set<string>();

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

/** Drop cached responses whose URL starts with any prefix, and refetch mounted hooks. */
export function invalidate(...prefixes: string[]) {
  for (const p of prefixes) bypassPrefixes.add(p);
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

/** Prefetch a URL into the cache (e.g. lists needed by the next page). */
export function prefetch(url: string) {
  if (getCached(url)) return;
  api<unknown>(url).then((d) => setCached(url, d)).catch(() => {});
}

/** Put a response into the cache under a URL, e.g. from a bulk bootstrap call. */
export function seed(url: string, data: unknown) {
  setCached(url, data);
}

// Back online after a drop: every mounted hook refetches, bypassing the browser cache.
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    bypassPrefixes.add("/api");
    listeners.forEach((l) => l(["/api"]));
  });
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
    const fresh = !!c && Date.now() - c.time < ttlMs;
    // Show whatever we have immediately; revalidate unless it is fresh.
    setState((s) => (c ? { data: c.data, error: undefined, loading: false, stale: !fresh } : { ...s, loading: s.data === undefined, stale: false }));
    if (fresh) return;
    // After a mutation the browser's cached copy is stale: force a network fetch once.
    const bypass = [...bypassPrefixes].some((p) => url.startsWith(p));
    if (bypass) for (const p of [...bypassPrefixes]) if (url.startsWith(p)) bypassPrefixes.delete(p);
    api<T>(url, bypass ? { cache: "reload" } : {})
      .then((d) => {
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
