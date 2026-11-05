import { randomInt } from "node:crypto";

export const ORIGIN = "http://localhost:3100";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- route handlers each declare their own params shape
type Handler = (req: Request, ctx: { params: Promise<any> }) => Promise<Response>;

type CallOpts = {
  body?: unknown;
  params?: Record<string, string>;
  /** Query string, e.g. "?reassignTo=..." */
  query?: string;
  headers?: Record<string, string>;
  /** Pretend the request comes from this IP (default: a random one, so per-IP limits don't leak between tests). */
  ip?: string;
};

export type Result<T = Record<string, unknown>> = { status: number; body: T; headers: Headers };

/**
 * Calls a route handler the way Next would: a real Request with a same-origin header,
 * JSON body and route params. Cookies come from the current jar (helpers/cookies.ts).
 */
export async function call<T = Record<string, unknown>>(fn: Handler, method: string, path: string, opts: CallOpts = {}): Promise<Result<T>> {
  const headers: Record<string, string> = {
    host: "localhost:3100",
    origin: ORIGIN,
    "sec-fetch-site": "same-origin",
    "user-agent": "vitest",
    "x-forwarded-for": opts.ip ?? `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`,
    ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
    ...(opts.headers ?? {}),
  };
  const req = new Request(`${ORIGIN}${path}${opts.query ?? ""}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const res = await fn(req, { params: Promise.resolve(opts.params ?? {}) });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON (CSV, redirects) stays as text */
  }
  return { status: res.status, body: body as T, headers: res.headers };
}
