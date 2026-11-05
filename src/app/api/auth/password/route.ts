import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { ApiError, handler, json, parseBody, requireUser } from "@/lib/api";
import { startSession } from "@/lib/auth";
import { clientIp } from "@/lib/rate-limit";
import { revokeAllSessions } from "@/lib/sessions";
import { invalidateTags } from "@/lib/server-cache";
import { changePasswordSchema } from "@/lib/validation";

/**
 * Change the caller's password. Bumps tokenVersion (every existing access token stops
 * working), revokes every refresh session, then starts a fresh session for this device.
 */
export const PATCH = handler(
  async (req) => {
    const me = await requireUser();
    const { currentPassword, newPassword } = await parseBody(req, changePasswordSchema);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: me.id } });
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) throw new ApiError(400, "Current password is incorrect.");
    const updated = await prisma.user.update({
      where: { id: me.id },
      data: { passwordHash: await bcrypt.hash(newPassword, 10), tokenVersion: { increment: 1 } },
      select: { id: true, tokenVersion: true },
    });
    await revokeAllSessions(me.id);
    invalidateTags("users");
    await startSession(updated, { remember: false, userAgent: req.headers.get("user-agent"), ip: clientIp(req) });
    return json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  },
  { limit: 10, windowMs: 15 * 60_000 },
);
