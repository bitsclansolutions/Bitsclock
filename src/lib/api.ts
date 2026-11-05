import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { getSessionUser, hasPermission, type SessionUser } from "./auth";
import type { Permission } from "./permissions";
import { clientIp, rateLimit } from "./rate-limit";
import { isCuid } from "./sanitize";

export class ApiError extends Error {
  status: number;
  headers?: Record<string, string>;
  constructor(status: number, message: string, headers?: Record<string, string>) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

export function json<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

/** FNV-1a hash of a string, hex. Cheap and good enough for an ETag. */
function etagOf(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `W/"${h.toString(16)}-${s.length.toString(36)}"`;
}

/**
 * JSON response for authenticated GET endpoints with browser caching:
 * - ETag + If-None-Match → 304 with no body when nothing changed.
 * - Cache-Control: private (per user), short max-age, stale-while-revalidate so the
 *   browser can reuse the body between navigations and refresh it in the background.
 */
export function jsonCached<T>(req: Request, data: T, opts: { maxAge?: number; swr?: number } = {}) {
  const { maxAge = 10, swr = 60 } = opts;
  const body = JSON.stringify(data);
  const etag = etagOf(body);
  const headers: Record<string, string> = {
    ETag: etag,
    "Cache-Control": `private, max-age=${maxAge}, stale-while-revalidate=${swr}`,
    Vary: "Cookie",
  };
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(body, { status: 200, headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
}

export function fail(status: number, message: string, headers?: Record<string, string>) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store", ...(headers ?? {}) } });
}

/** Resolve the caller or throw 401. Every handler calls this (directly or via requirePermission) before any data access. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new ApiError(401, "Sign in to continue.");
  return user;
}

/** Resolve the caller and require a permission, or throw 401/403. The check is server-side only; the UI is never trusted. */
export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const user = await requireUser();
  if (!hasPermission(user, permission)) throw new ApiError(403, "You don't have permission to do that.");
  return user;
}

/** Resolve the caller and require at least one of the permissions. */
export async function requireAnyPermission(...permissions: Permission[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!permissions.some((p) => hasPermission(user, p))) throw new ApiError(403, "You don't have permission to do that.");
  return user;
}

/** Validate a route id parameter. Anything that isn't a cuid is treated as "not found" so the format isn't probed. */
export function requireId(value: string | undefined, what = "Record") {
  if (!isCuid(value)) throw new ApiError(404, `${what} not found.`);
  return value;
}

const MAX_BODY_BYTES = 64 * 1024;

/** Parse and validate a JSON body. Enforces content type, size and object shape before the schema runs. */
export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  const type = req.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json")) throw new ApiError(415, "Request body must be JSON.");
  const length = Number(req.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) throw new ApiError(413, "Request body is too large.");
  let text: string;
  try {
    text = await req.text();
  } catch {
    throw new ApiError(400, "Request body could not be read.");
  }
  if (text.length > MAX_BODY_BYTES) throw new ApiError(413, "Request body is too large.");
  let raw: unknown;
  try {
    raw = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError(400, "Request body must be JSON.");
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new ApiError(400, "Request body must be a JSON object.");
  const result = schema.safeParse(raw);
  if (!result.success) throw new ApiError(400, firstZodMessage(result.error));
  return result.data;
}

/** Validate the query string against a schema (unknown keys are ignored, values are strings). */
export function parseQuery<T>(url: URL, schema: ZodType<T>): T {
  const entries: Record<string, string> = {};
  for (const [k, v] of url.searchParams) {
    if (k.length > 40 || v.length > 500) throw new ApiError(400, "Query parameter is too long.");
    entries[k] = v;
  }
  const result = schema.safeParse(entries);
  if (!result.success) throw new ApiError(400, firstZodMessage(result.error));
  return result.data;
}

export function firstZodMessage(err: ZodError) {
  const issue = err.issues[0];
  if (!issue) return "Invalid input.";
  const path = issue.path.length ? `${issue.path.map(String).join(".")}: ` : "";
  return `${path}${issue.message}`;
}

/** Reject cross-site state-changing requests (defence in depth on top of SameSite cookies). */
function assertSameOrigin(req: Request) {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "same-site" && site !== "none") throw new ApiError(403, "Cross-site request refused.");
  const origin = req.headers.get("origin");
  if (!origin) return;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  let originHost = "";
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new ApiError(403, "Cross-site request refused.");
  }
  if (!host || originHost !== host) throw new ApiError(403, "Cross-site request refused.");
}

export type HandlerOptions = {
  /** Requests allowed per IP per window on this route. Defaults: 600/min for GET, 120/min for mutations. */
  limit?: number;
  windowMs?: number;
};

const CUID_IN_PATH = /\/c[a-z0-9]{20,32}(?=\/|$)/g;

/**
 * Wrap a route handler:
 * - per-IP rate limit (429 with Retry-After),
 * - same-origin check for POST/PATCH/PUT/DELETE,
 * - ApiError / ZodError → JSON error responses, anything else → 500 without details.
 */
export function handler<Ctx>(fn: (req: Request, ctx: Ctx) => Promise<Response>, opts: HandlerOptions = {}) {
  return async (req: Request, ctx: Ctx) => {
    try {
      const method = req.method.toUpperCase();
      const mutating = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
      const route = new URL(req.url).pathname.replace(CUID_IN_PATH, "/:id");
      // Per-IP per-route defaults, tunable per deployment (e.g. behind a corporate NAT many users share one IP).
      const limit = opts.limit ?? (mutating ? Number(process.env.RATE_LIMIT_WRITES_PER_MIN) || 120 : Number(process.env.RATE_LIMIT_READS_PER_MIN) || 600);
      const rl = await rateLimit(`${route}:${method}:${clientIp(req)}`, limit, opts.windowMs ?? 60_000);
      if (!rl.ok) throw new ApiError(429, "Too many requests. Please slow down.", { "Retry-After": String(rl.retryAfterSec) });
      if (mutating) assertSameOrigin(req);
      const idem = mutating ? req.headers.get("idempotency-key") : null;
      if (idem && idem.length <= 128 && /^[A-Za-z0-9_-]+$/.test(idem)) {
        const me = await getSessionUser();
        if (me) return await withIdempotency(`${me.id}:${idem}`, me.id, () => fn(req, ctx));
      }
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof ApiError) return fail(e.status, e.message, e.headers);
      if (e instanceof ZodError) return fail(400, firstZodMessage(e));
      console.error(e);
      return fail(500, "Something went wrong on the server.");
    }
  };
}

/**
 * Exactly-once semantics for mutations: the first request with a given key runs and its
 * response is stored; a retry with the same key (after a dropped connection, a double
 * click, a flaky proxy) gets the stored response back and never runs the handler again.
 * Keys live 24 hours. Failures (5xx, exceptions) are not stored so a retry can succeed.
 */
async function withIdempotency(id: string, userId: string, run: () => Promise<Response>): Promise<Response> {
  const replay = (row: { status: number; body: string }) =>
    new Response(row.body, { status: row.status, headers: { "Content-Type": "application/json; charset=utf-8", "Idempotent-Replayed": "true", "Cache-Control": "no-store" } });
  const inProgress = () => new ApiError(409, "That request is still being processed. Please wait a moment.", { "Retry-After": "2" });

  const seen = await prisma.idempotencyKey.findUnique({ where: { id } });
  if (seen) {
    if (seen.status > 0) return replay(seen);
    throw inProgress();
  }
  try {
    await prisma.idempotencyKey.create({ data: { id, userId, status: 0, body: "" } });
  } catch (e) {
    // Lost a race with an identical concurrent request.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const row = await prisma.idempotencyKey.findUnique({ where: { id } });
      if (row && row.status > 0) return replay(row);
      throw inProgress();
    }
    throw e;
  }
  let res: Response;
  try {
    res = await run();
  } catch (e) {
    prisma.idempotencyKey.delete({ where: { id } }).catch(() => {});
    throw e;
  }
  if (res.status >= 500) {
    prisma.idempotencyKey.delete({ where: { id } }).catch(() => {});
    return res;
  }
  const body = await res.clone().text();
  if (body.length <= 200_000) await prisma.idempotencyKey.update({ where: { id }, data: { status: res.status, body } }).catch((e) => console.error("idempotency: could not store response", e));
  else prisma.idempotencyKey.delete({ where: { id } }).catch(() => {});
  if (Math.random() < 0.02) prisma.idempotencyKey.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 24 * 3600_000) } } }).catch(() => {});
  return res;
}

export type RouteParams<T extends Record<string, string>> = { params: Promise<T> };
