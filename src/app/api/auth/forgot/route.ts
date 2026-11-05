import { prisma } from "@/lib/prisma";
import { ApiError, handler, json, parseBody } from "@/lib/api";
import { appUrl, passwordResetCodeEmail, sendMail } from "@/lib/mail";
import { RESET_CODE_MINUTES, issueResetCode } from "@/lib/password-reset";
import { rateLimit } from "@/lib/rate-limit";
import { runAfterResponse } from "@/lib/background";
import { forgotPasswordSchema } from "@/lib/validation";

/**
 * Step 1 of "forgot password": email a 6-digit code.
 * Always answers 200 with the same body, and answers before any code is issued or mail
 * is sent (R-044), so neither the response nor its timing tells whether the address has
 * an account. Per-address limit on top of the per-IP one.
 */
export const POST = handler(
  async (req) => {
    const { email } = await parseBody(req, forgotPasswordSchema);
    const perAccount = await rateLimit(`forgot:${email}`, 3, 15 * 60_000);
    if (!perAccount.ok) throw new ApiError(429, "A code was sent recently. Check your inbox and spam folder, or try again in a few minutes.", { "Retry-After": String(perAccount.retryAfterSec) });

    const url = appUrl(req);
    runAfterResponse("reset code", async () => {
      const user = await prisma.user.findUnique({ where: { email }, select: { id: true, name: true, email: true, isActive: true } });
      if (!user || !user.isActive) return;
      const { code } = await issueResetCode(user.id);
      await sendMail(passwordResetCodeEmail({ to: user.email, name: user.name, code, minutes: RESET_CODE_MINUTES, url }));
    });
    return json({ ok: true, minutes: RESET_CODE_MINUTES }, { headers: { "Cache-Control": "no-store" } });
  },
  { limit: 10, windowMs: 15 * 60_000 },
);
