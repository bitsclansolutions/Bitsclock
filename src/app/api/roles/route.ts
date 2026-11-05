import { prisma } from "@/lib/prisma";
import { ApiError, handler, json, jsonCached, parseBody, requirePermission, requireUser } from "@/lib/api";
import { hasPermission } from "@/lib/auth";
import { listRoles } from "@/lib/roles";
import { roleCreateSchema } from "@/lib/validation";
import { cached, invalidateTags } from "@/lib/server-cache";

export const GET = handler(async (req) => {
  const me = await requireUser();
  if (!hasPermission(me, "roles.manage") && !hasPermission(me, "users.manage") && !hasPermission(me, "users.view")) {
    throw new ApiError(403, "You don't have permission to see roles.");
  }
  return jsonCached(req, { roles: await cached("roles", { ttlMs: 60_000, tags: ["roles", "users"] }, listRoles) }, { maxAge: 30 });
});

export const POST = handler(async (req) => {
  await requirePermission("roles.manage");
  const body = await parseBody(req, roleCreateSchema);
  const exists = await prisma.role.findUnique({ where: { name: body.name } });
  if (exists) throw new ApiError(409, "A role with this name already exists.");
  const role = await prisma.role.create({
    data: {
      name: body.name,
      description: body.description,
      color: body.color ?? "#2563eb",
      permissions: { create: body.permissions.map((permission) => ({ permission })) },
    },
  });
  invalidateTags("roles");
  return json({ role: { id: role.id, name: role.name } }, { status: 201 });
});
