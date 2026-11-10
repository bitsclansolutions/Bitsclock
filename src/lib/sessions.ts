import { createHash, randomBytes } from "crypto";
import { prisma, type Tx } from "./prisma";
import { runAfterResponse } from "./background";

/**
 * Refresh-token sessions. The raw token is a random 256-bit value handed to the
 * browser in an httpOnly cookie; the database keeps only its SHA-256 hash.
 * Every refresh rotates the token (old hash revoked, new one issued), so a
 * stolen refresh cookie is single-use and its reuse is detectable.
 */

export const REFRESH_REMEMBER_DAYS = 30;
export const REFRESH_SESSION_HOURS = 12;
/** A token rotated less than this long ago is reused instead of rotated again. */
const MIN_ROTATE_MS = 2 * 60_000;
/** After a rotation the previous token keeps working this long (concurrent requests, other tabs). */
const GRACE_MS = 90_000;

export function hashToken(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

function newRawToken() {
  return randomBytes(32).toString("base64url");
}

export function refreshExpiry(remember: boolean) {
  return new Date(Date.now() + (remember ? REFRESH_REMEMBER_DAYS * 86400_000 : REFRESH_SESSION_HOURS * 3600_000));
}

export async function createRefreshSession(user: { id: string; tokenVersion: number }, opts: { remember: boolean; userAgent?: string | null; ip?: string | null }) {
  const raw = newRawToken();
  const session = await prisma.refreshSession.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(raw),
      tokenVersion: user.tokenVersion,
      remember: opts.remember,
      userAgent: opts.userAgent?.slice(0, 300) ?? null,
      ip: opts.ip?.slice(0, 64) ?? null,
      expiresAt: refreshExpiry(opts.remember),
    },
  });
  // Housekeeping on sign-in (R-051): this user's sessions that ended over a week ago.
  // Runs after the response so sign-in doesn't wait for it.
  const cutoff = new Date(Date.now() - 7 * 86400_000);
  runAfterResponse("session prune", () => prisma.refreshSession.deleteMany({ where: { userId: user.id, OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }] } }));
  return { raw, session };
}

export type Rotated = { raw: string | null; sessionId: string; userId: string; tokenVersion: number; remember: boolean };

/**
 * Validate a refresh token and rotate it when due. Returns the session, the user's current
 * tokenVersion and the new raw token (null when the browser should keep its cookie), or
 * null when the token is unknown, expired, revoked, or from before a security reset.
 *
 * - Rotation happens at most every MIN_ROTATE_MS and is a compare-and-swap on the token
 *   hash (R-012): when two requests race, one rotates and the other is treated as the
 *   just-replaced token, which is valid for GRACE_MS. Nobody is signed out by a race.
 * - Reuse detection (R-024): a replaced token presented after the grace window means a
 *   copy of the cookie is in someone else's hands, so the whole session is revoked.
 * - A session issued under an older tokenVersion is refused (D-003): one bump of the
 *   user's tokenVersion ends every device.
 */
export async function rotateRefreshSession(raw: string, meta: { userAgent?: string | null; ip?: string | null }): Promise<Rotated | null> {
  const hash = hashToken(raw);
  const now = new Date();
  const include = { user: { select: { id: true, isActive: true, tokenVersion: true } } } as const;
  let session = await prisma.refreshSession.findUnique({ where: { tokenHash: hash }, include });
  let viaPrevious = false;
  if (!session) {
    const replaced = await prisma.refreshSession.findFirst({ where: { prevTokenHash: hash }, include });
    if (!replaced) return null;
    if (now.getTime() - replaced.rotatedAt.getTime() > GRACE_MS) {
      await prisma.refreshSession.updateMany({ where: { id: replaced.id, revokedAt: null }, data: { revokedAt: now } });
      return null;
    }
    session = replaced;
    viaPrevious = true;
  }
  if (session.revokedAt || session.expiresAt < now || !session.user.isActive || session.tokenVersion !== session.user.tokenVersion) return null;

  const result = (newRaw: string | null): Rotated => ({ raw: newRaw, sessionId: session.id, userId: session.userId, tokenVersion: session.user.tokenVersion, remember: session.remember });
  const touch = {
    lastUsedAt: now,
    userAgent: meta.userAgent?.slice(0, 300) ?? session.userAgent,
    ip: meta.ip?.slice(0, 64) ?? session.ip,
    // Sliding expiry for remembered devices; fixed for plain sessions.
    ...(session.remember ? { expiresAt: refreshExpiry(true) } : {}),
  };
  if (viaPrevious || now.getTime() - session.rotatedAt.getTime() < MIN_ROTATE_MS) {
    await prisma.refreshSession.updateMany({ where: { id: session.id, revokedAt: null }, data: touch });
    return result(null);
  }
  const next = newRawToken();
  const swapped = await prisma.refreshSession.updateMany({
    where: { id: session.id, tokenHash: hash, revokedAt: null },
    data: { ...touch, prevTokenHash: hash, tokenHash: hashToken(next), rotatedAt: now },
  });
  // Lost the race: another request rotated this session a moment ago, so our token is now
  // the previous one and still within its grace window. Keep the cookie; the browser will
  // receive the new one from the request that won.
  return result(swapped.count === 1 ? next : null);
}

/** Is this session still live? Used to reject access tokens of a signed-out device (R-060). */
export async function isSessionLive(sessionId: string) {
  const s = await prisma.refreshSession.findUnique({ where: { id: sessionId }, select: { revokedAt: true, expiresAt: true } });
  return !!s && !s.revokedAt && s.expiresAt > new Date();
}

export async function revokeRefreshSession(raw: string) {
  const hash = hashToken(raw);
  await prisma.refreshSession.updateMany({ where: { OR: [{ tokenHash: hash }, { prevTokenHash: hash }], revokedAt: null }, data: { revokedAt: new Date() } });
}

/** Revoke every device session for a user (sign out everywhere, deactivation, password change). */
export async function revokeAllSessions(userId: string) {
  await prisma.refreshSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}

type SecurityDb = Pick<Tx, "refreshSession" | "passwordReset">;

/**
 * The second half of every security reset (D-003, R-065). Call it inside the same
 * transaction that bumps the user's tokenVersion: every refresh session is revoked and
 * every unused reset code is deleted, so nothing issued before the reset still works.
 */
export async function revokeCredentialsTx(tx: SecurityDb, userId: string) {
  const now = new Date();
  await tx.refreshSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
  await tx.passwordReset.deleteMany({ where: { userId, usedAt: null } });
}

export type SessionDTO = {
  id: string;
  current: boolean;
  remember: boolean;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
};

/** Live sessions for a user, newest activity first. `currentRaw` is this device's refresh token. */
export async function listSessions(userId: string, currentRaw: string | undefined): Promise<SessionDTO[]> {
  const currentHash = currentRaw ? hashToken(currentRaw) : null;
  const rows = await prisma.refreshSession.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastUsedAt: "desc" },
    take: 50,
  });
  return rows.map((s) => ({
    id: s.id,
    current: s.tokenHash === currentHash,
    remember: s.remember,
    userAgent: s.userAgent,
    ip: s.ip,
    createdAt: s.createdAt.toISOString(),
    lastUsedAt: s.lastUsedAt.toISOString(),
    expiresAt: s.expiresAt.toISOString(),
  }));
}

/** Revoke one of the user's own sessions by id. Returns false when it isn't theirs. */
export async function revokeSessionById(userId: string, sessionId: string) {
  const res = await prisma.refreshSession.updateMany({ where: { id: sessionId, userId, revokedAt: null }, data: { revokedAt: new Date() } });
  return res.count > 0;
}

/** Housekeeping: drop sessions that expired or were revoked more than a week ago. */
export async function pruneSessions() {
  const cutoff = new Date(Date.now() - 7 * 86400_000);
  await prisma.refreshSession.deleteMany({ where: { OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }] } });
}
