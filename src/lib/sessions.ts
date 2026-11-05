import { createHash, randomBytes } from "crypto";
import { prisma } from "./prisma";

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

export async function createRefreshSession(userId: string, opts: { remember: boolean; userAgent?: string | null; ip?: string | null }) {
  const raw = newRawToken();
  const session = await prisma.refreshSession.create({
    data: {
      userId,
      tokenHash: hashToken(raw),
      remember: opts.remember,
      userAgent: opts.userAgent?.slice(0, 300) ?? null,
      ip: opts.ip?.slice(0, 64) ?? null,
      expiresAt: refreshExpiry(opts.remember),
    },
  });
  return { raw, session };
}

/**
 * Validate a refresh token and rotate it when due. Returns the user id, the remember
 * flag and the new raw token (null when the existing cookie should be kept), or null
 * when the token is unknown, expired or revoked.
 *
 * Rotation happens at most every MIN_ROTATE_MS, and the previous token stays valid
 * for GRACE_MS after a rotation, so a burst of concurrent requests (the page, its
 * prefetches, other tabs) that all carry the old token do not sign the user out.
 */
export async function rotateRefreshSession(raw: string, meta: { userAgent?: string | null; ip?: string | null }) {
  const hash = hashToken(raw);
  const now = new Date();
  const include = { user: { select: { id: true, isActive: true } } } as const;
  let session = await prisma.refreshSession.findUnique({ where: { tokenHash: hash }, include });
  let viaPrevious = false;
  if (!session) {
    session = await prisma.refreshSession.findFirst({ where: { prevTokenHash: hash, rotatedAt: { gt: new Date(now.getTime() - GRACE_MS) } }, include });
    viaPrevious = true;
  }
  if (!session || session.revokedAt || session.expiresAt < now || !session.user.isActive) return null;

  const touch = {
    lastUsedAt: now,
    userAgent: meta.userAgent?.slice(0, 300) ?? session.userAgent,
    ip: meta.ip?.slice(0, 64) ?? session.ip,
    // Sliding expiry for remembered devices; fixed for plain sessions.
    ...(session.remember ? { expiresAt: refreshExpiry(true) } : {}),
  };
  if (viaPrevious || now.getTime() - session.rotatedAt.getTime() < MIN_ROTATE_MS) {
    await prisma.refreshSession.update({ where: { id: session.id }, data: touch });
    return { raw: null, userId: session.userId, remember: session.remember };
  }
  const next = newRawToken();
  await prisma.refreshSession.update({
    where: { id: session.id },
    data: { ...touch, prevTokenHash: session.tokenHash, tokenHash: hashToken(next), rotatedAt: now },
  });
  return { raw: next, userId: session.userId, remember: session.remember };
}

export async function revokeRefreshSession(raw: string) {
  await prisma.refreshSession.updateMany({ where: { tokenHash: hashToken(raw), revokedAt: null }, data: { revokedAt: new Date() } });
}

/** Revoke every device session for a user (sign out everywhere, deactivation, password change). */
export async function revokeAllSessions(userId: string) {
  await prisma.refreshSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
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
