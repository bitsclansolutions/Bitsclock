import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { ApiError, handler, json, parseBody, requireUser } from "@/lib/api";
import { startSession } from "@/lib/auth";
import { clientIp } from "@/lib/rate-limit";
import { revokeCredentialsTx } from "@/lib/sessions";
import { invalidateTags } from "@/lib/server-cache";
import { changePasswordSchema } from "@/lib/validation";

/**
 * Change the caller's password. In one transaction (D-003): new hash + tokenVersion bump
 * (every access token stops working), every refresh session revoked, every pending reset
 * code deleted. Then a fresh session is started for this device.
 */
export const PATCH = handler(
  async (req) => {
    const me = await requireUser();
    const { currentPassword, newPassword } = await parseBody(req, changePasswordSchema);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: me.id }, select: { passwordHash: true } });
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) throw new ApiError(400, "Current password is incorrect.");
    const passwordHash = await bcrypt.hash(newPassword, 10);
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.user.update({ where: { id: me.id }, data: { passwordHash, tokenVersion: { increment: 1 } }, select: { id: true, tokenVersion: true } });
      await revokeCredentialsTx(tx, me.id);
      return u;
    });
    invalidateTags("users");
    await startSession(updated, { remember: false, userAgent: req.headers.get("user-agent"), ip: clientIp(req) });
    return json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  },
  { limit: 10, windowMs: 15 * 60_000 },
);
