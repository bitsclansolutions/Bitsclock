import { prisma } from "@/lib/prisma";
import { ApiError, handler, json, parseBody, parseQuery, requireAdmin, requireId, type RouteParams } from "@/lib/api";
import { audit } from "@/lib/audit";
import { ADMIN_ROLE_NAME } from "@/lib/permissions";
import { roleDeleteQuerySchema, roleUpdateSchema } from "@/lib/validation";
import { invalidateTags } from "@/lib/server-cache";
import { clientIp } from "@/lib/rate-limit";

/** Edit a role (Administrator only, D-001). The Administrator role itself can't be edited. */
export const PATCH = handler<RouteParams<{ id: string }>>(async (req, { params }) => {
  const me = await requireAdmin();
  const id = requireId((await params).id, "Role");
  const body = await parseBody(req, roleUpdateSchema);
  const role = await prisma.role.findUnique({ where: { id }, include: { permissions: true } });
  if (!role) throw new ApiError(404, "Role not found.");
  if (role.name === ADMIN_ROLE_NAME) throw new ApiError(403, "The Administrator role always has every permission and can't be changed.");
  if (role.isSystem && body.name && body.name !== role.name) throw new ApiError(400, "System roles can't be renamed.");
  if (body.name && body.name !== role.name) {
    if (body.name === ADMIN_ROLE_NAME) throw new ApiError(400, "That name is reserved.");
    const exists = await prisma.role.findUnique({ where: { name: body.name } });
    if (exists) throw new ApiError(409, "A role with this name already exists.");
  }
  await prisma.$transaction(async (tx) => {
    await tx.role.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.color !== undefined ? { color: body.color } : {}),
      },
    });
    if (body.permissions) {
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      if (body.permissions.length) {
        await tx.rolePermission.createMany({ data: body.permissions.map((permission) => ({ roleId: id, permission })) });
      }
    }
    const before = role.permissions.map((p) => p.permission).sort();
    await audit(
      {
        actor: me,
        action: "role.update",
        targetType: "role",
        targetId: id,
        summary: `Updated role ${body.name ?? role.name}`,
        meta: body.permissions ? { permissionsBefore: before, permissionsAfter: [...body.permissions].sort() } : undefined,
        ip: clientIp(req),
      },
      tx,
    );
  });
  // Sessions cache permissions, so members with this role pick up the change on their next request.
  invalidateTags("roles");
  return json({ ok: true });
});

/**
 * Delete a custom role (Administrator only). Members who have it are moved to another
 * role, which can never be Administrator; they're signed out everywhere so the new
 * permissions apply at once (D-003).
 */
export const DELETE = handler<RouteParams<{ id: string }>>(async (req, { params }) => {
  const me = await requireAdmin();
  const id = requireId((await params).id, "Role");
  const { reassignTo } = parseQuery(new URL(req.url), roleDeleteQuerySchema);
  await prisma.$transaction(async (tx) => {
    const role = await tx.role.findUnique({ where: { id }, include: { _count: { select: { users: true, memberRequests: { where: { status: "pending" } } } } } });
    if (!role) throw new ApiError(404, "Role not found.");
    if (role.isSystem) throw new ApiError(400, "System roles can't be deleted.");
    if (role._count.memberRequests > 0) throw new ApiError(409, `${role._count.memberRequests} pending member request(s) ask for this role. Approve or reject them first.`);
    let movedTo: string | null = null;
    if (role._count.users > 0) {
      if (!reassignTo) throw new ApiError(409, `${role._count.users} member(s) have this role. Choose a role to move them to first.`);
      const target = await tx.role.findUnique({ where: { id: reassignTo } });
      if (!target || target.id === id) throw new ApiError(400, "Choose a valid role to move members to.");
      if (target.name === ADMIN_ROLE_NAME) throw new ApiError(403, "Members can't be moved into the Administrator role.");
      const members = await tx.user.findMany({ where: { roleId: id }, select: { id: true } });
      await tx.user.updateMany({ where: { roleId: id }, data: { roleId: target.id, tokenVersion: { increment: 1 } } });
      await tx.refreshSession.updateMany({ where: { userId: { in: members.map((m) => m.id) }, revokedAt: null }, data: { revokedAt: new Date() } });
      movedTo = target.name;
    }
    // Requests that were already decided keep their history; they point at the role being removed.
    await tx.memberRequest.deleteMany({ where: { roleId: id, status: { not: "pending" } } });
    await tx.role.delete({ where: { id } });
    await audit(
      { actor: me, action: "role.delete", targetType: "role", targetId: id, summary: `Deleted role ${role.name}${movedTo ? `, moved ${role._count.users} member(s) to ${movedTo}` : ""}`, ip: clientIp(req) },
      tx,
    );
  });
  invalidateTags("roles", "users");
  return json({ ok: true });
});
