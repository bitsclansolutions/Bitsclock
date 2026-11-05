"use client";

/** Recent API round-trip times (ms), newest last. Used for the slow-connection alert. */
const latencySamples: number[] = [];
const latencyListeners = new Set<(samples: number[]) => void>();
export function onLatency(cb: (samples: number[]) => void) {
  latencyListeners.add(cb);
  return () => {
    latencyListeners.delete(cb);
  };
}
function recordLatency(ms: number) {
  latencySamples.push(ms);
  if (latencySamples.length > 8) latencySamples.shift();
  latencyListeners.forEach((l) => l([...latencySamples]));
}

export type ApiErrorKind = "http" | "network" | "timeout" | "offline";

/** Error thrown by `api()`. `kind` tells callers whether it was the server (http) or the connection. */
export class ApiClientError extends Error {
  kind: ApiErrorKind;
  status: number;
  constructor(kind: ApiErrorKind, message: string, status = 0) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

export const isNetworkError = (e: unknown) => e instanceof ApiClientError && e.kind !== "http";

const REQUEST_TIMEOUT_MS = 30_000;
const RETRY_DELAYS_MS = [400, 1200];
const RETRYABLE_STATUS = new Set([502, 503, 504]);

function randomId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms + Math.random() * 200));

type ApiInit = RequestInit & {
  json?: unknown;
  /** false = never retry (default: retry network failures and 502/503/504). */
  retry?: boolean;
  timeoutMs?: number;
  /** Reuse a key to make a mutation safe to resend; generated automatically for mutations. */
  idempotencyKey?: string;
};

/**
 * Fetch wrapper for the app's own API routes. Throws ApiClientError on failure.
 *
 * Resilience:
 * - Every request has a timeout.
 * - GETs are retried on network failure, timeout and 502/503/504 with a short backoff.
 * - Mutations carry an `Idempotency-Key`; the server stores the first response under that
 *   key, so a retry after a dropped connection can never create a duplicate entry.
 * - A 401 triggers one token refresh and a transparent replay.
 */
export async function api<T>(path: string, init: ApiInit = {}): Promise<T> {
  const { json: body, retry = true, timeoutMs = REQUEST_TIMEOUT_MS, idempotencyKey, ...rest } = init;
  const method = (rest.method ?? "GET").toUpperCase();
  const mutating = method !== "GET" && method !== "HEAD";
  const headers: Record<string, string> = { ...((rest.headers as Record<string, string>) ?? {}) };
  if (mutating) headers["Idempotency-Key"] = idempotencyKey ?? randomId();
  const attempts = retry ? RETRY_DELAYS_MS.length + 1 : 1;

  let res: Response | null = null;
  let lastErr: ApiClientError | null = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const started = Date.now();
    try {
      res = await apiFetch(path, { ...rest, headers }, body, method, timeoutMs);
      recordLatency(Date.now() - started);
      lastErr = null;
    } catch (e) {
      recordLatency(Date.now() - started);
      lastErr = classify(e);
      res = null;
    }
    if (res && RETRYABLE_STATUS.has(res.status) && attempt < attempts - 1) {
      await sleep(RETRY_DELAYS_MS[attempt]!);
      continue;
    }
    if (res) break;
    if (lastErr && lastErr.kind !== "offline" && attempt < attempts - 1) {
      await sleep(RETRY_DELAYS_MS[attempt]!);
      continue;
    }
    break;
  }
  if (!res) throw lastErr ?? new ApiClientError("network", "Couldn't reach the server. Check your connection and try again.");

  // Access token expired: refresh once (shared across concurrent callers) and replay the request.
  if (res.status === 401 && !path.startsWith("/api/auth/")) {
    if (await refreshAccess()) {
      try {
        res = await apiFetch(path, { ...rest, headers, cache: "no-store" }, body, method, timeoutMs);
      } catch (e) {
        throw classify(e);
      }
    }
  }
  return finish<T>(res);
}

function classify(e: unknown): ApiClientError {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return new ApiClientError("offline", "You're offline. Check your connection and try again.");
  if (e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError")) return new ApiClientError("timeout", "The server took too long to answer. Please try again.");
  return new ApiClientError("network", "Couldn't reach the server. Check your connection and try again.");
}

let refreshing: Promise<boolean> | null = null;
/** POST /api/auth/refresh, de-duplicated so parallel 401s trigger a single rotation. */
export function refreshAccess(): Promise<boolean> {
  if (!refreshing) {
    refreshing = fetch("/api/auth/refresh", { method: "POST", credentials: "same-origin", cache: "no-store" })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

async function apiFetch(path: string, rest: RequestInit, body: unknown, method: string, timeoutMs: number) {
  const signal = rest.signal ? AbortSignal.any([rest.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  return fetch(path, {
    ...rest,
    signal,
    headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(rest.headers ?? {}) },
    body: body !== undefined ? JSON.stringify(body) : rest.body,
    credentials: "same-origin",
    // GETs use the browser HTTP cache (ETag / max-age from the API); callers pass
    // cache: "reload" right after a mutation. Mutations are never cached.
    cache: rest.cache ?? (method === "GET" ? "default" : "no-store"),
  });
}

async function finish<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      // Session expired: a full reload to the sign-in page clears all client state.
      window.location.replace(new URL(`/login?next=${encodeURIComponent(window.location.pathname)}`, window.location.origin).toString());
    }
    throw new ApiClientError("http", "Your session has expired. Sign in again.", 401);
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    throw new ApiClientError("http", `The server sent an unreadable response (${res.status}).`, res.status);
  }
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error ?? `Request failed (${res.status}).`;
    throw new ApiClientError("http", msg, res.status);
  }
  return data as T;
}

export function tzName() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Local day-key range → ISO instants covering [from 00:00, to 23:59:59.999]. */
export function rangeToInstants(from: string, to: string) {
  const a = new Date(from + "T00:00:00");
  const b = new Date(to + "T23:59:59.999");
  return { from: a.toISOString(), to: b.toISOString() };
}

export function qs(params: Record<string, string | number | boolean | null | undefined>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export function errMsg(e: unknown, fallback = "Something went wrong.") {
  return e instanceof Error && e.message ? e.message : fallback;
}
