import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { handler, json, parseBody, ApiError } from "@/lib/api";
import { startSession, toSessionUser, userWithRole } from "@/lib/auth";
import { clientIp, rateLimit, rateLimitReset } from "@/lib/rate-limit";
import { loginSchema } from "@/lib/validation";

// Hash compared when the email is unknown, so a wrong email takes as long as a wrong password.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);

export const POST = handler(
  async (req) => {
    const { email, password, remember } = await parseBody(req, loginSchema);
    const ip = clientIp(req);
    // Per-account throttle on top of the per-IP one from the handler wrapper.
    const perAccount = await rateLimit(`login:${email}`, 8, 15 * 60_000);
    if (!perAccount.ok) throw new ApiError(429, "Too many sign-in attempts for this account. Try again in a few minutes.", { "Retry-After": String(perAccount.retryAfterSec) });

    const user = await prisma.user.findUnique({ where: { email }, ...userWithRole });
    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) throw new ApiError(401, "Incorrect email or password.");
    if (!user.isActive) throw new ApiError(403, "This account has been deactivated. Contact your administrator.");

    await rateLimitReset(`login:${email}`);
    await startSession(user, { remember, userAgent: req.headers.get("user-agent"), ip });
    return json({ user: toSessionUser(user) }, { headers: { "Cache-Control": "no-store" } });
  },
  { limit: 20, windowMs: 15 * 60_000 },
);
