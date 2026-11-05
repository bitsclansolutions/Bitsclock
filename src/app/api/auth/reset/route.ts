import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { ApiError, handler, json, parseBody } from "@/lib/api";
import { appUrl, passwordChangedEmail, sendMail } from "@/lib/mail";
import { checkResetCode, consumeResetCode, pruneResetCodes } from "@/lib/password-reset";
import { rateLimit, rateLimitReset } from "@/lib/rate-limit";
import { revokeAllSessions } from "@/lib/sessions";
import { invalidateTags } from "@/lib/server-cache";
import { resetPasswordSchema } from "@/lib/validation";

const INVALID = "That code is incorrect or has expired. Request a new one.";

/**
 * Step 2 of "forgot password": verify the emailed code and set the new password.
 * Every existing session and access token is invalidated; the user signs in again.
 */
export const POST = handler(
  async (req) => {
    const { email, code, newPassword } = await parseBody(req, resetPasswordSchema);
    const perAccount = await rateLimit(`reset:${email}`, 10, 15 * 60_000);
    if (!perAccount.ok) throw new ApiError(429, "Too many attempts. Request a new code in a few minutes.", { "Retry-After": String(perAccount.retryAfterSec) });

    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, name: true, email: true, isActive: true } });
    if (!user || !user.isActive) throw new ApiError(400, INVALID);

    const check = await checkResetCode(user.id, code);
    if (!check.ok) throw new ApiError(400, check.reason === "locked" ? "Too many wrong codes. Request a new one." : INVALID);

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(newPassword, 10), tokenVersion: { increment: 1 } },
    });
    await consumeResetCode(check.resetId);
    await revokeAllSessions(user.id);
    invalidateTags("users");
    await rateLimitReset(`reset:${email}`);
    await rateLimitReset(`login:${email}`);
    void pruneResetCodes();
    void sendMail(passwordChangedEmail({ to: user.email, name: user.name, url: appUrl(req) }));
    return json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  },
  { limit: 15, windowMs: 15 * 60_000 },
);
