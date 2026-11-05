import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { ApiError, handler, json, parseBody } from "@/lib/api";
import { appUrl, passwordChangedEmail, sendMail } from "@/lib/mail";
import { pruneResetCodes, verifyAndConsumeResetCodeTx } from "@/lib/password-reset";
import { rateLimit, rateLimitReset } from "@/lib/rate-limit";
import { revokeCredentialsTx } from "@/lib/sessions";
import { invalidateTags } from "@/lib/server-cache";
import { runAfterResponse } from "@/lib/background";
import { resetPasswordSchema } from "@/lib/validation";

const INVALID = "That code is incorrect or has expired. Request a new one.";

/**
 * Step 2 of "forgot password": verify the emailed code and set the new password.
 * All-or-nothing (D-003, R-004): the code is consumed, the password and tokenVersion change,
 * every refresh session is revoked and every other reset code deleted, in one transaction.
 * A wrong code still counts as an attempt (the transaction returns instead of throwing).
 */
export const POST = handler(
  async (req) => {
    const { email, code, newPassword } = await parseBody(req, resetPasswordSchema);
    const perAccount = await rateLimit(`reset:${email}`, 10, 15 * 60_000);
    if (!perAccount.ok) throw new ApiError(429, "Too many attempts. Request a new code in a few minutes.", { "Retry-After": String(perAccount.retryAfterSec) });

    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, name: true, email: true, isActive: true } });
    if (!user || !user.isActive) throw new ApiError(400, INVALID);
    const passwordHash = await bcrypt.hash(newPassword, 10);

    const outcome = await prisma.$transaction(async (tx) => {
      const result = await verifyAndConsumeResetCodeTx(tx, user.id, code);
      if (result !== "ok") return result;
      await tx.user.update({ where: { id: user.id }, data: { passwordHash, tokenVersion: { increment: 1 } } });
      await revokeCredentialsTx(tx, user.id);
      return result;
    });
    if (outcome === "locked") throw new ApiError(400, "Too many wrong codes. Request a new one.");
    if (outcome !== "ok") throw new ApiError(400, INVALID);

    invalidateTags("users");
    await rateLimitReset(`reset:${email}`);
    await rateLimitReset(`login:${email}`);
    runAfterResponse("reset cleanup", pruneResetCodes);
    runAfterResponse("password-changed email", () => sendMail(passwordChangedEmail({ to: user.email, name: user.name, url: appUrl(req) })));
    return json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  },
  { limit: 15, windowMs: 15 * 60_000 },
);
