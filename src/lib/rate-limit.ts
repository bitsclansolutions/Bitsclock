/**
 * Rate limiter for abuse-prone endpoints (sign-in, refresh, every API route).
 *
 * With Redis configured (see kv.ts) counters are shared by every instance, so the
 * limit holds across a scaled-out deployment. Without it (local development), a
 * per-process sliding window is used.
 */

import { kv, kvEnabled, kvPipeline } from "./kv";

// Each bucket remembers its own window, so the sweep never trims a 15-minute bucket with
// a 1-minute window (R-013: that turned "8 sign-ins per 15 min" into roughly 8 per minute).
type Bucket = { hits: number[]; windowMs: number };
const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();

function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, b] of buckets) {
    b.hits = b.hits.filter((t) => now - t < b.windowMs);
    if (b.hits.length === 0) buckets.delete(key);
  }
}

function memoryLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  sweep(now);
  const b = buckets.get(key) ?? { hits: [], windowMs };
  b.windowMs = Math.max(b.windowMs, windowMs);
  b.hits = b.hits.filter((t) => now - t < windowMs);
  if (b.hits.length >= limit) {
    const retryAfterSec = Math.max(1, Math.ceil((b.hits[0]! + windowMs - now) / 1000));
    buckets.set(key, b);
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

/** A numeric limit from the environment, or the default. Read per call so it can be tuned without a deploy of code. */
export function envLimit(name: string, fallback: number) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Test hook: forget every in-memory counter. */
export function __resetRateLimitsForTests() {
  buckets.clear();
}

/**
 * The client's address, for rate limiting and session records (R-045).
 * The left-most X-Forwarded-For entry is whatever the client typed, so it's never used:
 * - CLIENT_IP_HEADER (e.g. "x-real-ip", "cf-connecting-ip"): the header the host's own
 *   proxy sets and clients can't forge. On Vercel, x-real-ip is used automatically.
 * - Otherwise the right-most X-Forwarded-For entry, which the nearest proxy appended.
 */
export function clientIp(req: Request) {
  const configured = process.env.CLIENT_IP_HEADER?.trim().toLowerCase() || (process.env.VERCEL ? "x-real-ip" : "");
  if (configured) {
    const v = req.headers.get(configured)?.split(",")[0]?.trim();
    if (v) return v.slice(0, 64);
  }
  const fwd = req.headers.get("x-forwarded-for");
  const rightMost = fwd?.split(",").map((s) => s.trim()).filter(Boolean).pop();
  return (rightMost || req.headers.get("x-real-ip") || "unknown").slice(0, 64);
}
