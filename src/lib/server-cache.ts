/**
 * Two-level response cache.
 *
 * L1: per-process memory (microseconds, dies with the instance). Bounded LRU; expired
 *     entries are dropped when touched (R-050).
 * L2: shared Redis via Upstash REST, required in production (D-004), so every instance
 *     serves the same cached responses and sees the same invalidations.
 *
 * Entries carry tags. A mutation calls `invalidateTags(...)`: locally every value with one
 * of those tags is dropped; in Redis the tag's version counter is bumped, and because
 * versions are part of the L2 key, older values are never read again. The Redis bump is
 * awaited before the response leaves (`settleInvalidations`, called by the API handler),
 * so no instance can serve the old value to the client's very next request (R-016).
 *
 * Tags: "users" | "roles" | "projects" | "settings", "entries" for anything that spans the
 * team, and "entries:<userId>" for caches of one person's own time (R-030), so one member's
 * edit doesn't throw away everyone else's cached dashboards and lists.
 *
 * In-flight loads are de-duplicated, and a load that was overtaken by an invalidation
 * doesn't write its (now stale) result into the cache (R-017).
 */

import { kv, kvEnabled, kvPipeline } from "./kv";

export type CacheTag = "users" | "roles" | "projects" | "entries" | "settings" | `entries:${string}`;

type Entry = { value: unknown; expires: number; tags: Set<string> };

const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();
const MAX_ENTRIES = 2000;

// Local generation per tag: bumped by every invalidation in this process (stale-write guard).
const generations = new Map<string, number>();
const gen = (t: string) => generations.get(t) ?? 0;

// Tag versions from Redis, cached briefly per tag so the hot path costs one round trip per few seconds.
const versions = new Map<string, { v: number; at: number }>();
const VERSIONS_TTL_MS = 2000;

async function tagVersions(tags: CacheTag[]): Promise<number[]> {
  const now = Date.now();
  const missing = tags.filter((t) => {
    const hit = versions.get(t);
    return !hit || now - hit.at >= VERSIONS_TTL_MS;
  });
  if (missing.length) {
    try {
      const raw = await kv<(string | null)[]>("MGET", ...missing.map((t) => `tagver:${t}`));
      missing.forEach((t, i) => versions.set(t, { v: Number(raw[i] ?? 0), at: now }));
    } catch {
      for (const t of missing) if (!versions.has(t)) versions.set(t, { v: 0, at: now });
    }
  }
  return tags.map((t) => versions.get(t)?.v ?? 0);
}

function l1Get(key: string) {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (hit.expires <= Date.now()) {
    store.delete(key);
    return undefined;
  }
  // Move to the end: Map order is the LRU order.
  store.delete(key);
  store.set(key, hit);
  return hit;
}

function l1Set(key: string, value: unknown, ttlMs: number, tags: CacheTag[]) {
  store.delete(key);
  while (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
  store.set(key, { value, expires: Date.now() + ttlMs, tags: new Set(tags) });
}

export async function cached<T>(key: string, opts: { ttlMs: number; tags: CacheTag[] }, loader: () => Promise<T>): Promise<T> {
  // With Redis the key carries the tag versions, so an invalidation anywhere changes the key everywhere.
  const fullKey = kvEnabled ? `${key}|${(await tagVersions(opts.tags)).join(".")}` : key;

  const hit = l1Get(fullKey);
  if (hit) return hit.value as T;

  const pending = inflight.get(fullKey);
  if (pending) return pending as Promise<T>;

  const before = opts.tags.map(gen);
  const p = (async () => {
    if (kvEnabled) {
      try {
        const raw = await kv<string | null>("GET", `c:${fullKey}`);
        if (raw) {
          const value = JSON.parse(raw) as T;
          l1Set(fullKey, value, Math.min(opts.ttlMs, 5000), opts.tags);
          return value;
        }
      } catch {
        /* Redis unavailable: fall through to the loader */
      }
    }
    const value = await loader();
    // Invalidated while we were loading: the value may predate the change, so don't keep it.
    const overtaken = opts.tags.some((t, i) => gen(t) !== before[i]);
    if (!overtaken) {
      l1Set(fullKey, value, opts.ttlMs, opts.tags);
      if (kvEnabled) await kv("SET", `c:${fullKey}`, JSON.stringify(value), "PX", opts.ttlMs).catch(() => {});
    }
    return value;
  })().finally(() => inflight.delete(fullKey));
  inflight.set(fullKey, p);
  return p;
}

// Redis version bumps not yet confirmed; the API handler awaits them before responding.
const pendingBumps = new Set<Promise<unknown>>();

export function invalidateTags(...tags: CacheTag[]) {
  if (!tags.length) return;
  for (const t of tags) generations.set(t, gen(t) + 1);
  for (const [key, entry] of store) {
    if (tags.some((t) => entry.tags.has(t))) store.delete(key);
  }
  // In-flight loads still finish, but the generation check stops them caching what they got.
  if (kvEnabled) {
    for (const t of tags) versions.delete(t); // re-read after the bump
    const bump = kvPipeline(tags.map((t) => ["INCR", `tagver:${t}`]))
      .catch(() => {})
      .finally(() => pendingBumps.delete(bump));
    pendingBumps.add(bump);
  }
}

/** Await every Redis invalidation started so far. Called by the API handler before it responds (R-016). */
export async function settleInvalidations() {
  if (pendingBumps.size) await Promise.all([...pendingBumps]);
}

/** Tags for a cache of entries belonging to `userIds` (undefined = the whole team). */
export function entryTags(userIds: string[] | undefined): CacheTag[] {
  return userIds && userIds.length <= 20 ? userIds.map((u) => `entries:${u}` as const) : ["entries"];
}

/** Invalidate after a write to these members' entries: their own caches and every team-wide one. */
export function invalidateEntries(...userIds: string[]) {
  invalidateTags("entries", ...userIds.map((u) => `entries:${u}` as const));
}

/** Test hook: forget every cached value (tests reset the database between files). */
export function __resetCacheForTests() {
  store.clear();
  inflight.clear();
  versions.clear();
  generations.clear();
}

/** Stable string for query params so equivalent requests share a cache key. */
export function paramsKey(sp: URLSearchParams) {
  return [...sp.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}
