import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { ApiError, handler, json, parseBody, requireAdmin, requireId, type RouteParams } from "@/lib/api";
import { audit } from "@/lib/audit";
import { appUrl, passwordResetByAdminEmail, sendMail } from "@/lib/mail";
import { generateTempPassword } from "@/lib/password-reset";
import { revokeCredentialsTx } from "@/lib/sessions";
import { invalidateTags } from "@/lib/server-cache";
import { adminResetPasswordSchema } from "@/lib/validation";
import { isAdminRow, recordEmailOutcome } from "@/lib/member-admin";
import { clientIp } from "@/lib/rate-limit";

/**
 * The Administrator resets a member's password (D-001). The body may carry a password;
 * when blank one is generated. In one transaction (D-003): new hash + tokenVersion bump,
 * every refresh session revoked, every pending reset code deleted, audit record written.
 * The member is then emailed the temporary password; when that fails it's returned once
 * so the Administrator can pass it on. It is never stored in plain text.
 */
export const POST = handler<RouteParams<{ id: string }>>(async (req, { params }) => {
  const me = await requireAdmin();
  const id = requireId((await params).id, "Member");
  const body = await parseBody(req, adminResetPasswordSchema);
  const password = body.password ?? generateTempPassword();
  const passwordHash = await bcrypt.hash(password, 10);

  const target = await prisma.$transaction(async (tx) => {
    const t = await tx.user.findUnique({ where: { id }, include: { role: true } });
    if (!t || t.deletedAt) throw new ApiError(404, "Member not found.");
    if (isAdminRow(t)) throw new ApiError(403, "Change the Administrator's password from Profile, which asks for the current one.");
    if (!t.isActive) throw new ApiError(400, "Reactivate the member before resetting their password.");
    await tx.user.update({ where: { id }, data: { passwordHash, tokenVersion: { increment: 1 } } });
    await revokeCredentialsTx(tx, id);
    await audit({ actor: me, action: "user.password_reset", targetType: "user", targetId: id, summary: `Reset ${t.name}'s password`, ip: clientIp(req) }, tx);
    return t;
  });
  invalidateTags("users");

  const emailSent = await sendMail(passwordResetByAdminEmail({ to: target.email, name: target.name, resetBy: me.name, password, url: appUrl(req) }));
  await recordEmailOutcome(id, emailSent, me, `new password email to ${target.email}`, clientIp(req));
  return json({ ok: true, emailSent, email: target.email, ...(emailSent ? {} : { tempPassword: password }) }, { headers: { "Cache-Control": "no-store" } });
});
