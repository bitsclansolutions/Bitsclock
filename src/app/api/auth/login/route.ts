import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { handler, json, parseBody, ApiError } from "@/lib/api";
import { startSession, toSessionUser, userWithRole } from "@/lib/auth";
import { clientIp, envLimit, rateLimit, rateLimitReset } from "@/lib/rate-limit";
import { loginSchema } from "@/lib/validation";
import { passwordMatches } from "@/lib/password";

// Hash compared when the email is unknown, so a wrong email takes as long as a wrong password.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);
const WINDOW = 15 * 60_000;

/**
 * One message for an unknown email and a wrong password, on purpose: separate messages
 * would let anyone test which addresses have an account (user enumeration, OWASP ASVS
 * V2.2 / Authentication Cheat Sheet). Decided 2026-11-05 (D-010).
 */
const BAD_CREDENTIALS = "That email and password don't match. Check both, or reset your password.";
const waitText = (sec: number) => {
  const min = Math.ceil(sec / 60);
  return min <= 1 ? "about a minute" : `${min} minutes`;
};

/**
 * Sign in. Three limits (R-006, R-047):
 * - per IP, generous (LOGIN_LIMIT_PER_IP, default 300 / 15 min): a whole office shares one IP;
 * - per account + IP, strict (8 / 15 min): stops password guessing from one place;
 * - per account, looser (50 / 15 min): stops a distributed guess without letting a stranger
 *   lock someone out by failing 8 times from their own address.
 */
export const POST = handler(
  async (req) => {
    const { email, password, remember } = await parseBody(req, loginSchema);
    const ip = clientIp(req);
    const tooMany = (retry: number) =>
      new ApiError(429, `Too many sign-in attempts. For your security, wait ${waitText(retry)} and try again, or reset your password.`, { "Retry-After": String(retry) });
    const here = await rateLimit(`login:${email}:${ip}`, 8, WINDOW);
    if (!here.ok) throw tooMany(here.retryAfterSec);
    const anywhere = await rateLimit(`login:${email}`, envLimit("LOGIN_LIMIT_PER_ACCOUNT", 50), WINDOW);
    if (!anywhere.ok) throw tooMany(anywhere.retryAfterSec);

    const user = await prisma.user.findUnique({ where: { email }, ...userWithRole });
    const ok = await passwordMatches(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) throw new ApiError(401, BAD_CREDENTIALS);
    // Only reached with the right password, so saying "deactivated" reveals nothing new.
    if (!user.isActive) throw new ApiError(403, "This account has been deactivated. Ask your administrator to reactivate it.");

    await rateLimitReset(`login:${email}:${ip}`);
    await startSession(user, { remember, userAgent: req.headers.get("user-agent"), ip });
    return json({ user: toSessionUser(user) }, { headers: { "Cache-Control": "no-store" } });
  },
  { limit: () => envLimit("LOGIN_LIMIT_PER_IP", 300), windowMs: WINDOW },
);
