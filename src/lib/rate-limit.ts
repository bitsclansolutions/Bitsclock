/**
 * Rate limiter for abuse-prone endpoints (sign-in, refresh, every API route).
 *
 * With Redis configured (see kv.ts) counters are shared by every instance, so the
 * limit holds across a scaled-out deployment. Without it, a per-process sliding
 * window is used, which still caps brute force at (limit × instances).
 */

import { kv, kvEnabled, kvPipeline } from "./kv";

type Bucket = { hits: number[] };
const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();

function sweep(now: number, windowMs: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, b] of buckets) {
    b.hits = b.hits.filter((t) => now - t < windowMs);
    if (b.hits.length === 0) buckets.delete(key);
  }
}

function memoryLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  sweep(now, windowMs);
  const b = buckets.get(key) ?? { hits: [] };
  b.hits = b.hits.filter((t) => now - t < windowMs);
  if (b.hits.length >= limit) {
    const retryAfterSec = Math.max(1, Math.ceil((b.hits[0]! + windowMs - now) / 1000));
    return { ok: false, retryAfterSec };
  }
  b.hits.push(now);
  buckets.set(key, b);
  return { ok: true, retryAfterSec: 0 };
}

/** Returns ok=true and records the hit when within the limit; ok=false with a Retry-After hint otherwise. */
export async function rateLimit(key: string, limit: number, windowMs: number): Promise<{ ok: boolean; retryAfterSec: number }> {
  if (!kvEnabled) return memoryLimit(key, limit, windowMs);
  // Fixed window shared across instances: one INCR + expiry per hit.
  const now = Date.now();
  const window = Math.floor(now / windowMs);
  const k = `rl:${key}:${window}`;
  try {
    const [count] = await kvPipeline<number>([
      ["INCR", k],
      ["PEXPIRE", k, windowMs, "NX"],
    ]);
    if (count > limit) return { ok: false, retryAfterSec: Math.max(1, Math.ceil(((window + 1) * windowMs - now) / 1000)) };
    return { ok: true, retryAfterSec: 0 };
  } catch {
    // Redis unreachable: degrade to the local window rather than refusing traffic.
    return memoryLimit(key, limit, windowMs);
  }
}

/** Forget a key, e.g. after a successful sign-in. */
export async function rateLimitReset(key: string, windowMs = 15 * 60_000) {
  buckets.delete(key);
  if (!kvEnabled) return;
  const window = Math.floor(Date.now() / windowMs);
  await kv("DEL", `rl:${key}:${window}`).catch(() => {});
}

/** Best-effort client address behind Vercel / proxies. */
export function clientIp(req: Request) {
  const fwd = req.headers.get("x-forwarded-for");
  const ip = fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  return ip.slice(0, 64);
}
