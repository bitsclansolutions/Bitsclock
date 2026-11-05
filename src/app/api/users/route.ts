import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { ApiError, handler, json, jsonCached, parseBody, parseQuery, requirePermission, requireUser } from "@/lib/api";
import { hasPermission } from "@/lib/auth";
import { userCreateSchema, usersQuerySchema } from "@/lib/validation";
import { cached, invalidateTags } from "@/lib/server-cache";
import { loadMembers } from "@/lib/members";
import { appUrl, invitationEmail, sendMail } from "@/lib/mail";
import { generateTempPassword } from "@/lib/password-reset";

export type { MemberDTO } from "@/lib/members";

/**
 * Row-level scoping:
 * - users.view (Team page): every member with email, status, running timer and weekly hours.
 * - time.view_all / reports.view_all / projects.manage (pickers only): active members with
 *   id, name and role; email and activity are withheld.
 * - Anyone else: 403.
 */
export const GET = handler(async (req) => {
  const me = await requireUser();
  const full = hasPermission(me, "users.view");
  const canList = full || hasPermission(me, "time.view_all") || hasPermission(me, "reports.view_all") || hasPermission(me, "projects.manage");
  if (!canList) throw new ApiError(403, "You don't have permission to see members.");

  const q = parseQuery(new URL(req.url), usersQuerySchema);
  const weekStart = full && q.weekStart ? new Date(q.weekStart) : new Date(NaN);
  const key = Number.isNaN(weekStart.getTime()) ? "" : weekStart.toISOString();
  const members = await cached(`users:${full ? "full" : "min"}:${key}`, { ttlMs: 30_000, tags: ["users", "roles", "entries"] }, () => loadMembers(weekStart, full));
  return jsonCached(req, { members }, { maxAge: 15 });
});

/**
 * Add a member. The temporary password is the one the administrator typed, or a generated
 * one when left blank. An invitation with the sign-in link and the password is emailed;
 * when it could not be sent the password comes back in the response so the administrator
 * can pass it on another way.
 */
export const POST = handler(async (req) => {
  const me = await requirePermission("users.manage");
  const body = await parseBody(req, userCreateSchema);
  const role = await prisma.role.findUnique({ where: { id: body.roleId } });
  if (!role) throw new ApiError(400, "Choose a valid role.");
  const exists = await prisma.user.findUnique({ where: { email: body.email } });
  if (exists) throw new ApiError(409, "A member with this email already exists.");
  const password = body.password ?? generateTempPassword();
  const user = await prisma.user.create({
    data: {
      name: body.name,
      email: body.email,
      jobTitle: body.jobTitle,
      roleId: role.id,
      passwordHash: await bcrypt.hash(password, 10),
    },
    include: { role: { select: { id: true, name: true, color: true } } },
  });
  invalidateTags("users");
  const emailSent = await sendMail(invitationEmail({ to: user.email, name: user.name, invitedBy: me.name, password, url: appUrl(req) }));
  return json(
    { member: { id: user.id, name: user.name, email: user.email, role: user.role }, emailSent, ...(emailSent ? {} : { tempPassword: password }) },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
});
