import { prisma } from "@/lib/prisma";
import { handler, json, parseBody } from "@/lib/api";
import { endSession, getSessionUser } from "@/lib/auth";
import { revokeCredentialsTx } from "@/lib/sessions";
import { invalidateTags } from "@/lib/server-cache";
import { logoutSchema } from "@/lib/validation";

/**
 * Sign out this device, or every device when `{ everywhere: true }` is sent.
 * "Everywhere" bumps tokenVersion in the same transaction as the revoke, so access tokens
 * on other devices stop working immediately, not after their 15 minutes (R-060, D-003).
 */
export const POST = handler(async (req) => {
  const body = req.headers.get("content-type")?.includes("application/json") ? await parseBody(req, logoutSchema) : { everywhere: false };
  if (body.everywhere) {
    const me = await getSessionUser();
    if (me) {
      await prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: me.id }, data: { tokenVersion: { increment: 1 } } });
        await revokeCredentialsTx(tx, me.id);
      });
    }
  }
  await endSession();
  // Drops cached session checks so this device's access token is refused at once.
  invalidateTags("users");
  return json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
});
