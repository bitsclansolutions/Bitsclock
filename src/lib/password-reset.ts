import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { prisma } from "./prisma";

/**
 * Self-service password reset codes.
 * - 6 digits, generated with a CSPRNG, sent by email.
 * - Only HMAC-SHA256(AUTH_SECRET, userId:code) is stored, so a database leak cannot be
 *   used to reset passwords.
 * - Each code lives 15 minutes, allows 5 wrong guesses, and is consumed on first use.
 *   Requesting a new code invalidates the previous ones.
 */

export const RESET_CODE_MINUTES = 15;
export const RESET_MAX_ATTEMPTS = 5;

function hashCode(userId: string, code: string) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET must be set in .env.");
  return createHmac("sha256", secret).update(`${userId}:${code}`).digest("hex");
}

/** Alphabet without look-alike characters (0/O, 1/l/I) so a password read from an email is typed correctly. */
const PW_LOWER = "abcdefghijkmnpqrstuvwxyz";
const PW_UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const PW_DIGIT = "23456789";
const PW_ALL = PW_LOWER + PW_UPPER + PW_DIGIT;

/** Temporary password for invitations and admin resets: 12 characters, guaranteed to satisfy the password rule. */
export function generateTempPassword(length = 12) {
  const pick = (set: string) => set[randomInt(set.length)]!;
  const chars = [pick(PW_LOWER), pick(PW_UPPER), pick(PW_DIGIT)];
  while (chars.length < length) chars.push(pick(PW_ALL));
  // Fisher–Yates so the guaranteed classes are not always at the front.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join("");
}

/** Create a fresh code for the user (invalidating older ones) and return it in clear for the email. */
export async function issueResetCode(userId: string) {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAt = new Date(Date.now() + RESET_CODE_MINUTES * 60_000);
  await prisma.$transaction([
    prisma.passwordReset.deleteMany({ where: { userId } }),
    prisma.passwordReset.create({ data: { userId, codeHash: hashCode(userId, code), expiresAt } }),
  ]);
  return { code, expiresAt };
}

export type ResetCheck = { ok: true; resetId: string } | { ok: false; reason: "invalid" | "locked" };

/**
 * Check a submitted code. The attempt is counted before the comparison so a wrong guess
 * is never free; after RESET_MAX_ATTEMPTS the code is dead and a new one must be requested.
 */
export async function checkResetCode(userId: string, code: string): Promise<ResetCheck> {
  const reset = await prisma.passwordReset.findFirst({
    where: { userId, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!reset) return { ok: false, reason: "invalid" };
  if (reset.attempts >= RESET_MAX_ATTEMPTS) return { ok: false, reason: "locked" };
  const updated = await prisma.passwordReset.update({ where: { id: reset.id }, data: { attempts: { increment: 1 } }, select: { attempts: true } });
  const expected = Buffer.from(reset.codeHash, "hex");
  const given = Buffer.from(hashCode(userId, code), "hex");
  const match = expected.length === given.length && timingSafeEqual(expected, given);
  if (!match) return { ok: false, reason: updated.attempts >= RESET_MAX_ATTEMPTS ? "locked" : "invalid" };
  return { ok: true, resetId: reset.id };
}

/** Mark a code as used so it cannot be replayed. */
export async function consumeResetCode(resetId: string) {
  await prisma.passwordReset.update({ where: { id: resetId }, data: { usedAt: new Date() } });
}

/** Opportunistic cleanup of expired / used rows. */
export async function pruneResetCodes() {
  await prisma.passwordReset.deleteMany({ where: { OR: [{ expiresAt: { lt: new Date(Date.now() - 24 * 3600_000) } }, { usedAt: { not: null } }] } }).catch(() => {});
}
