/**
 * Two-level response cache.
 *
 * L1: per-process memory (microseconds, dies with the instance).
 * L2: shared Redis via Upstash REST when configured (see kv.ts), so every instance
 *     of the app serves the same cached responses and sees the same invalidations.
 *
 * Entries carry tags. A mutation calls `invalidateTags("entries")`: locally every
 * value tagged "entries" is dropped; in Redis the tag's version counter is bumped,
 * and because versions are part of the L2 key, older values are never read again.
 * In-flight loads are de-duplicated so a burst of identical requests hits the
 * database once per instance.
 */

import { kv, kvEnabled, kvPipeline } from "./kv";

type Entry = { value: unknown; expires: number; tags: Set<string> };

const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();
const MAX_ENTRIES = 2000;

export type CacheTag = "users" | "roles" | "projects" | "entries";
const TAGS: CacheTag[] = ["users", "roles", "projects", "entries"];

// Tag versions from Redis, cached briefly so the hot path costs one round trip per few seconds.
let versions: Record<CacheTag, number> | null = null;
let versionsAt = 0;
const VERSIONS_TTL_MS = 2000;

async function tagVersions(): Promise<Record<CacheTag, number>> {
  const now = Date.now();
  if (versions && now - versionsAt < VERSIONS_TTL_MS) return versions;
  try {
    const raw = await kv<(string | null)[]>("MGET", ...TAGS.map((t) => `tagver:${t}`));
    versions = Object.fromEntries(TAGS.map((t, i) => [t, Number(raw[i] ?? 0)])) as Record<CacheTag, number>;
  } catch {
    versions = versions ?? (Object.fromEntries(TAGS.map((t) => [t, 0])) as Record<CacheTag, number>);
  }
  versionsAt = now;
  return versions;
}

function l1Set(key: string, value: unknown, ttlMs: number, tags: CacheTag[]) {
  if (store.size >= MAX_ENTRIES) {
    let n = Math.floor(MAX_ENTRIES / 3);
    for (const k of store.keys()) {
      if (n-- <= 0) break;
      store.delete(k);
    }
  }
  store.set(key, { value, expires: Date.now() + ttlMs, tags: new Set(tags) });
}

export async function cached<T>(key: string, opts: { ttlMs: number; tags: CacheTag[] }, loader: () => Promise<T>): Promise<T> {
  const now = Date.now();
  // With Redis the key carries the tag versions, so an invalidation anywhere changes the key everywhere.
  const fullKey = kvEnabled ? `${key}|${(await tagVersions().then((v) => opts.tags.map((t) => v[t]).join("."))) || ""}` : key;

  const hit = store.get(fullKey);
  if (hit && hit.expires > now) return hit.value as T;

  const pending = inflight.get(fullKey);
  if (pending) return pending as Promise<T>;

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
    l1Set(fullKey, value, opts.ttlMs, opts.tags);
    if (kvEnabled) {
      kv("SET", `c:${fullKey}`, JSON.stringify(value), "PX", opts.ttlMs).catch(() => {});
    }
    return value;
  })().finally(() => inflight.delete(fullKey));
  inflight.set(fullKey, p);
  return p;
}

export function invalidateTags(...tags: CacheTag[]) {
  for (const [key, entry] of store) {
    for (const t of tags) {
      if (entry.tags.has(t)) {
        store.delete(key);
        break;
      }
    }
  }
  if (kvEnabled && tags.length) {
    versions = null; // re-read after the bump
    kvPipeline(tags.map((t) => ["INCR", `tagver:${t}`])).catch(() => {});
  }
}

/** Stable string for query params so equivalent requests share a cache key. */
export function paramsKey(sp: URLSearchParams) {
  return [...sp.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}
