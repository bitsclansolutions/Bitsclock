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
export function api<T>(path: string, init: ApiInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  if (method === "GET" || method === "HEAD" || init.idempotencyKey) return apiOnce<T>(path, init);
  // A double click (or two handlers) sending the same change while the first is still on
  // its way share one request and one Idempotency-Key, so it can't be applied twice (R-015).
  const sig = `${method} ${path} ${init.json !== undefined ? JSON.stringify(init.json) : ""}`;
  const pending = inflightMutations.get(sig);
  if (pending) return pending as Promise<T>;
  const p = apiOnce<T>(path, init).finally(() => inflightMutations.delete(sig));
  inflightMutations.set(sig, p);
  return p;
}

const inflightMutations = new Map<string, Promise<unknown>>();

async function apiOnce<T>(path: string, init: ApiInit = {}): Promise<T> {
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
      // Session expired: a full reload to the sign-in page clears all client state. Open
      // forms have already kept their drafts (R-038); sign-in returns to this exact page.
      const here = window.location.pathname + window.location.search;
      window.location.replace(new URL(`/login?expired=1&next=${encodeURIComponent(here)}`, window.location.origin).toString());
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

/** Data rows in a CSV text (records split on line breaks outside quotes), not counting the header. */
export function countCsvRows(text: string) {
  let records = 0;
  let inQuotes = false;
  let sawContent = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (c === "\n" || c === "\r")) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      if (sawContent) records++;
      sawContent = false;
      continue;
    }
    if (c !== "﻿") sawContent = true;
  }
  if (sawContent) records++;
  return Math.max(0, records - 1);
}

/**
 * Download a CSV through fetch (R-032, D-002): an expired session is refreshed like any
 * other API call instead of silently saving an error page, and when the server announces
 * the row count (`X-Total-Rows`) a short file is refused rather than saved. Returns the row count.
 */
export async function downloadCsv(path: string, fallbackName: string) {
  const get = () => fetch(path, { credentials: "same-origin", cache: "no-store" });
  let res: Response;
  try {
    res = await get();
    if (res.status === 401 && (await refreshAccess())) res = await get();
  } catch (e) {
    throw classify(e);
  }
  if (!res.ok) {
    // Session gone even after a refresh: finish() sends the browser to sign in and throws.
    if (res.status === 401) await finish<never>(res);
    let msg = `Download failed (${res.status}).`;
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch {
      /* not JSON */
    }
    throw new ApiClientError("http", msg, res.status);
  }
  let text: string;
  try {
    text = await res.text();
  } catch {
    throw new ApiClientError("network", "The download was interrupted. Please try again; nothing was saved.");
  }
  const expected = res.headers.get("X-Total-Rows");
  const rows = countCsvRows(text);
  if (expected !== null && rows !== Number(expected)) {
    throw new ApiClientError("http", `Export incomplete (${rows} of ${expected} rows arrived). Nothing was saved; please try again.`);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? fallbackName;
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return rows;
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
