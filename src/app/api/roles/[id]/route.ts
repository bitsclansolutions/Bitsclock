import { prisma } from "@/lib/prisma";
import { ApiError, handler, json, parseBody, parseQuery, requireId, requirePermission, type RouteParams } from "@/lib/api";
import { ADMIN_ROLE_NAME } from "@/lib/permissions";
import { roleDeleteQuerySchema, roleUpdateSchema } from "@/lib/validation";
import { invalidateTags } from "@/lib/server-cache";

export const PATCH = handler<RouteParams<{ id: string }>>(async (req, { params }) => {
  await requirePermission("roles.manage");
  const id = requireId((await params).id, "Role");
  const body = await parseBody(req, roleUpdateSchema);
  const role = await prisma.role.findUnique({ where: { id } });
  if (!role) throw new ApiError(404, "Role not found.");
  if (role.name === ADMIN_ROLE_NAME) throw new ApiError(403, "The Administrator role always has every permission and can't be changed.");
  if (role.isSystem && body.name && body.name !== role.name) throw new ApiError(400, "System roles can't be renamed.");
  if (body.name && body.name !== role.name) {
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
  });
  // Sessions cache permissions, so members with this role pick up the change on their next request.
  invalidateTags("roles");
  return json({ ok: true });
});

export const DELETE = handler<RouteParams<{ id: string }>>(async (req, { params }) => {
  await requirePermission("roles.manage");
  const id = requireId((await params).id, "Role");
  const role = await prisma.role.findUnique({ where: { id }, include: { _count: { select: { users: true } } } });
  if (!role) throw new ApiError(404, "Role not found.");
  if (role.isSystem) throw new ApiError(400, "System roles can't be deleted.");
  const { reassignTo } = parseQuery(new URL(req.url), roleDeleteQuerySchema);
  if (role._count.users > 0) {
    if (!reassignTo) throw new ApiError(409, `${role._count.users} member(s) have this role. Choose a role to move them to first.`);
    const target = await prisma.role.findUnique({ where: { id: reassignTo } });
    if (!target || target.id === id) throw new ApiError(400, "Choose a valid role to move members to.");
    await prisma.user.updateMany({ where: { roleId: id }, data: { roleId: target.id } });
  }
  await prisma.role.delete({ where: { id } });
  invalidateTags("roles", "users");
  return json({ ok: true });
});
