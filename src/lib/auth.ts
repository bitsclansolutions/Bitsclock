import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { prisma } from "./prisma";
import { ADMIN_ROLE_NAME, ALL_PERMISSIONS, isGrantablePermission, type Permission } from "./permissions";
import { cached } from "./server-cache";
import { createRefreshSession, isSessionLive, revokeRefreshSession, rotateRefreshSession } from "./sessions";

/**
 * Session model
 * -------------
 * - Access token: short-lived JWT (HS256, 15 min) in the httpOnly cookie `bc_access`.
 *   Carries the user id and the user's tokenVersion so password changes and
 *   "sign out everywhere" invalidate it immediately.
 * - Refresh token: opaque random value in the httpOnly cookie `bc_refresh`, backed by a
 *   bc_refresh_sessions row (hash only). Rotated on every use. Lives 12 hours as a
 *   browser-session cookie, or 30 days persistent when "Remember me" was ticked.
 * Both cookies are httpOnly (unreadable from scripts), SameSite=Lax (not sent on
 * cross-site POSTs), Secure in production, and scoped to the site root.
 */

export const ACCESS_COOKIE = "bc_access";
export const REFRESH_COOKIE = "bc_refresh";
export const ACCESS_MINUTES = 15;
const ISSUER = "bitsclock";

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) {
    throw new Error("AUTH_SECRET must be set in .env (at least 32 characters).");
  }
  return new TextEncoder().encode(s);
}

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  jobTitle: string | null;
  isActive: boolean;
  role: { id: string; name: string; color: string; isSystem: boolean };
  permissions: Permission[];
  isAdmin: boolean;
};

/** `sid` is the refresh session this token belongs to; signing that device out ends the token too (R-060). */
export async function createAccessToken(userId: string, tokenVersion: number, sessionId: string) {
  return new SignJWT({ v: tokenVersion, typ: "access", sid: sessionId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_MINUTES}m`)
    .sign(secret());
}

/** Verify an access token: signature, expiry, issuer and type. Returns subject, version and session id, or null. */
export async function verifyAccessToken(token: string): Promise<{ userId: string; version: number; sessionId: string | null } | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { issuer: ISSUER, algorithms: ["HS256"] });
    if (payload.typ !== "access" || typeof payload.sub !== "string" || typeof payload.v !== "number") return null;
    return { userId: payload.sub, version: payload.v, sessionId: typeof payload.sid === "string" ? payload.sid : null };
  } catch {
    return null;
  }
}

/**
 * Cookies are Secure everywhere except a plain-http local development server (R-064).
 * This no longer depends on NODE_ENV, so a production server started with the wrong
 * NODE_ENV still never sends session cookies over plain HTTP.
 */
function cookiesMustBeSecure() {
  const app = process.env.APP_URL?.trim();
  if (app) return !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(app);
  return process.env.NODE_ENV === "production";
}

const baseCookie = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: cookiesMustBeSecure(),
  path: "/",
};

type CookieOptions = typeof baseCookie & { maxAge?: number };
/** Anything that can receive Set-Cookie: the request cookie store from next/headers, or a NextResponse's cookies. */
export type CookieJar = { set(name: string, value: string, options: CookieOptions): unknown };

/** Write the access cookie, and the refresh cookie when given. `remember` makes them persistent (30 days); otherwise they end with the browser session. */
export function writeSessionCookies(jar: CookieJar, access: string, refresh: string | null, remember: boolean) {
  // The access cookie persists for the refresh lifetime when remembered: the token inside
  // carries its own 15-minute expiry, and the proxy refreshes it transparently.
  jar.set(ACCESS_COOKIE, access, { ...baseCookie, ...(remember ? { maxAge: 30 * 24 * 60 * 60 } : {}) });
  if (refresh !== null) jar.set(REFRESH_COOKIE, refresh, { ...baseCookie, ...(remember ? { maxAge: 30 * 24 * 60 * 60 } : {}) });
}

export async function clearSessionCookies(jar?: CookieJar) {
  const s = jar ?? (await cookies());
  s.set(ACCESS_COOKIE, "", { ...baseCookie, maxAge: 0 });
  s.set(REFRESH_COOKIE, "", { ...baseCookie, maxAge: 0 });
}

/** Sign a user in: create a refresh session and issue both cookies. */
export async function startSession(user: { id: string; tokenVersion: number }, opts: { remember: boolean; userAgent?: string | null; ip?: string | null }) {
  const { raw, session } = await createRefreshSession(user, opts);
  const access = await createAccessToken(user.id, user.tokenVersion, session.id);
  writeSessionCookies(await cookies(), access, raw, opts.remember);
}

/**
 * Exchange the refresh cookie for a new access token (rotating the refresh token when due).
 * Cookies are written to `jar` (defaults to the request cookie store; a redirect handler
 * passes its response's cookies so they travel with the 303).
 * Returns the user id, or null when the refresh token is missing/invalid (cookies cleared).
 */
export async function refreshSession(meta: { userAgent?: string | null; ip?: string | null }, jar?: CookieJar): Promise<string | null> {
  const store = await cookies();
  const target = jar ?? store;
  const raw = store.get(REFRESH_COOKIE)?.value;
  if (!raw || raw.length > 200) {
    await clearSessionCookies(target);
    return null;
  }
  // rotateRefreshSession already refuses inactive users and sessions from before a reset.
  const rotated = await rotateRefreshSession(raw, meta);
  if (!rotated) {
    await clearSessionCookies(target);
    return null;
  }
  const access = await createAccessToken(rotated.userId, rotated.tokenVersion, rotated.sessionId);
  writeSessionCookies(target, access, rotated.raw, rotated.remember);
  return rotated.userId;
}

/** Sign out this device: revoke its refresh session and clear both cookies. */
export async function endSession() {
  const store = await cookies();
  const raw = store.get(REFRESH_COOKIE)?.value;
  if (raw) await revokeRefreshSession(raw);
  await clearSessionCookies(store);
}

type UserRow = {
  id: string;
  email: string;
  name: string;
  jobTitle: string | null;
  isActive: boolean;
  tokenVersion: number;
  role: { id: string; name: string; color: string; isSystem: boolean; permissions: { permission: string }[] };
};

export function toSessionUser(u: UserRow): SessionUser {
  const isAdmin = u.role.name === ADMIN_ROLE_NAME;
  // Admin-only permissions are ignored on any other role even if a row grants them (D-001).
  const permissions = isAdmin ? [...ALL_PERMISSIONS] : (u.role.permissions.map((p) => p.permission).filter(isGrantablePermission) as Permission[]);
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    jobTitle: u.jobTitle,
    isActive: u.isActive,
    role: { id: u.role.id, name: u.role.name, color: u.role.color, isSystem: u.role.isSystem },
    permissions,
    isAdmin,
  };
}

export const userWithRole = { include: { role: { include: { permissions: true } } } } as const;

/** What a signed-in session needs, and nothing more (no password hash). */
export const sessionUserSelect = {
  id: true,
  email: true,
  name: true,
  jobTitle: true,
  isActive: true,
  tokenVersion: true,
  role: { select: { id: true, name: true, color: true, isSystem: true, permissions: { select: { permission: true } } } },
} as const;

/**
 * Current user from the access cookie, or null. Every API handler and app page goes
 * through here: the token must verify, the user must exist, be active, and the
 * token's version must match the user's current tokenVersion.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(ACCESS_COOKIE)?.value;
  if (!token || token.length > 2048) return null;
  const claims = await verifyAccessToken(token);
  if (!claims) return null;
  // Cached for a minute; member, role and password mutations invalidate the "users"/"roles" tags.
  // Only the fields a session needs are loaded and cached, never the password hash (R-018).
  const user = await cached(`session:${claims.userId}`, { ttlMs: 60_000, tags: ["users", "roles"] }, () =>
    prisma.user.findUnique({ where: { id: claims.userId }, select: sessionUserSelect }),
  );
  if (!user || !user.isActive || user.tokenVersion !== claims.version) return null;
  // The device this token was issued to must still be signed in (R-060). Tokens issued
  // before session ids existed carry none and simply expire within 15 minutes.
  if (claims.sessionId) {
    const sid = claims.sessionId;
    const live = await cached(`sid:${sid}`, { ttlMs: 60_000, tags: ["users"] }, () => isSessionLive(sid));
    if (!live) return null;
  }
  return toSessionUser(user);
}

export function hasPermission(user: SessionUser, permission: Permission) {
  return user.isAdmin || user.permissions.includes(permission);
}
