import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { ApiError, handler, json, parseBody, requireId, requirePermission, type RouteParams } from "@/lib/api";
import { ADMIN_ROLE_NAME } from "@/lib/permissions";
import { userUpdateSchema } from "@/lib/validation";
import { invalidateTags } from "@/lib/server-cache";
import { revokeAllSessions } from "@/lib/sessions";

/** Throws if the change would leave the workspace without an active administrator. */
async function assertNotLastAdmin(userId: string) {
  const target = await prisma.user.findUnique({ where: { id: userId }, include: { role: true } });
  if (!target || target.role.name !== ADMIN_ROLE_NAME || !target.isActive) return;
  const admins = await prisma.user.count({ where: { isActive: true, role: { name: ADMIN_ROLE_NAME }, id: { not: userId } } });
  if (admins === 0) throw new ApiError(409, "This is the only active administrator. Make someone else an administrator first.");
}

export const PATCH = handler<RouteParams<{ id: string }>>(async (req, { params }) => {
  const me = await requirePermission("users.manage");
  const id = requireId((await params).id, "Member");
  const body = await parseBody(req, userUpdateSchema);
  const target = await prisma.user.findUnique({ where: { id }, include: { role: true } });
  if (!target) throw new ApiError(404, "Member not found.");

  if (id === me.id) {
    if (body.isActive === false) throw new ApiError(400, "You can't deactivate your own account.");
    if (body.roleId && body.roleId !== target.roleId) throw new ApiError(400, "You can't change your own role.");
  }
  if (body.roleId && body.roleId !== target.roleId) {
    const role = await prisma.role.findUnique({ where: { id: body.roleId } });
    if (!role) throw new ApiError(400, "Choose a valid role.");
    await assertNotLastAdmin(id);
  }
  if (body.isActive === false) await assertNotLastAdmin(id);
  if (body.email && body.email !== target.email) {
    const exists = await prisma.user.findUnique({ where: { email: body.email } });
    if (exists) throw new ApiError(409, "A member with this email already exists.");
  }

  const user = await prisma.user.update({
    where: { id },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.email !== undefined ? { email: body.email } : {}),
      ...(body.jobTitle !== undefined ? { jobTitle: body.jobTitle } : {}),
      ...(body.roleId !== undefined ? { roleId: body.roleId } : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      ...(body.password ? { passwordHash: await bcrypt.hash(body.password, 10) } : {}),
      // A password reset, deactivation or role change must take effect on every device at once.
      ...(body.password || body.isActive === false || (body.roleId && body.roleId !== target.roleId) ? { tokenVersion: { increment: 1 } } : {}),
    },
    include: { role: { select: { id: true, name: true, color: true } } },
  });
  if (body.password || body.isActive === false) await revokeAllSessions(id);
  invalidateTags("users");
  // Deactivating someone also stops any timer they left running.
  if (body.isActive === false) {
    const running = await prisma.timeEntry.findFirst({ where: { userId: id, endTime: null } });
    if (running) {
      const end = new Date();
      await prisma.timeEntry.update({
        where: { id: running.id },
        data: { endTime: end, durationSeconds: Math.max(1, Math.round((end.getTime() - running.startTime.getTime()) / 1000)) },
      });
      invalidateTags("entries");
    }
  }
  return json({ member: { id: user.id, name: user.name, email: user.email, jobTitle: user.jobTitle ?? "", isActive: user.isActive, role: user.role } });
});

export const DELETE = handler<RouteParams<{ id: string }>>(async (_req, { params }) => {
  const me = await requirePermission("users.manage");
  const id = requireId((await params).id, "Member");
  if (id === me.id) throw new ApiError(400, "You can't delete your own account.");
  const target = await prisma.user.findUnique({ where: { id }, include: { _count: { select: { timeEntries: true } } } });
  if (!target) throw new ApiError(404, "Member not found.");
  if (target._count.timeEntries > 0) {
    throw new ApiError(409, `${target.name} has ${target._count.timeEntries} time entries. Deactivate the account instead so the history stays in reports.`);
  }
  await assertNotLastAdmin(id);
  await prisma.user.delete({ where: { id } });
  invalidateTags("users", "projects");
  return json({ ok: true });
});
