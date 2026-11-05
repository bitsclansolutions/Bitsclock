/**
 * Minimal Redis client over the Upstash REST API (no SDK, no open sockets, works in
 * serverless). Used for the shared response cache and the rate limiter so every
 * instance of the app sees the same counters and the same invalidations.
 *
 * Enabled when UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set; otherwise
 * callers fall back to per-process memory, which is fine for a single server.
 */

const url = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/+$/, "");
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

export const kvEnabled = !!(url && token);

type Cmd = (string | number)[];

/** Run one command. Returns the raw result (strings for GET, numbers for INCR, null for misses). */
export async function kv<T = unknown>(...cmd: Cmd): Promise<T> {
  const res = await fetch(url!, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
    cache: "no-store",
    signal: AbortSignal.timeout(1500),
  });
  if (!res.ok) throw new Error(`kv ${cmd[0]} failed: ${res.status}`);
  const data = (await res.json()) as { result?: T; error?: string };
  if (data.error) throw new Error(`kv ${cmd[0]}: ${data.error}`);
  return data.result as T;
}

/** Run several commands in one round trip. */
export async function kvPipeline<T = unknown>(cmds: Cmd[]): Promise<T[]> {
  const res = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmds),
    cache: "no-store",
    signal: AbortSignal.timeout(1500),
  });
  if (!res.ok) throw new Error(`kv pipeline failed: ${res.status}`);
  const data = (await res.json()) as { result?: T; error?: string }[];
  return data.map((d) => {
    if (d.error) throw new Error(`kv pipeline: ${d.error}`);
    return d.result as T;
  });
}
