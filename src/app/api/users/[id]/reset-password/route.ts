import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { ApiError, handler, json, parseBody, requireId, requirePermission, type RouteParams } from "@/lib/api";
import { appUrl, passwordResetByAdminEmail, sendMail } from "@/lib/mail";
import { generateTempPassword } from "@/lib/password-reset";
import { revokeAllSessions } from "@/lib/sessions";
import { invalidateTags } from "@/lib/server-cache";
import { adminResetPasswordSchema } from "@/lib/validation";

/**
 * Administrator resets a member's password. The body may carry a password; when it is
 * blank one is generated. The member is signed out everywhere and emailed the new
 * temporary password. When the email could not be sent, the password is returned so
 * the administrator can pass it on another way.
 */
export const POST = handler<RouteParams<{ id: string }>>(async (req, { params }) => {
  const me = await requirePermission("users.manage");
  const id = requireId((await params).id, "Member");
  const body = await parseBody(req, adminResetPasswordSchema);
  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, name: true, email: true, isActive: true } });
  if (!target) throw new ApiError(404, "Member not found.");
  if (!target.isActive) throw new ApiError(400, "Reactivate the member before resetting their password.");

  const password = body.password ?? generateTempPassword();
  await prisma.user.update({ where: { id }, data: { passwordHash: await bcrypt.hash(password, 10), tokenVersion: { increment: 1 } } });
  await revokeAllSessions(id);
  invalidateTags("users");

  const emailSent = await sendMail(passwordResetByAdminEmail({ to: target.email, name: target.name, resetBy: me.name, password, url: appUrl(req) }));
  return json({ ok: true, emailSent, email: target.email, ...(emailSent ? {} : { tempPassword: password }) }, { headers: { "Cache-Control": "no-store" } });
});
