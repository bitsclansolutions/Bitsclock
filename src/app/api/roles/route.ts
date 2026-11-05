import { prisma } from "@/lib/prisma";
import { ApiError, handler, json, jsonCached, parseBody, requireAdmin, requireUser } from "@/lib/api";
import { hasPermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { listRoles } from "@/lib/roles";
import { roleCreateSchema } from "@/lib/validation";
import { cached, invalidateTags } from "@/lib/server-cache";
import { clientIp } from "@/lib/rate-limit";

/** Role list for the Roles page and the role pickers (Team page, member requests). */
export const GET = handler(async (req) => {
  const me = await requireUser();
  if (!me.isAdmin && !hasPermission(me, "users.view") && !hasPermission(me, "users.request") && !hasPermission(me, "users.deactivate")) {
    throw new ApiError(403, "You don't have permission to see roles.");
  }
  return jsonCached(req, { roles: await cached("roles", { ttlMs: 60_000, tags: ["roles", "users"] }, listRoles) }, { maxAge: 30 });
});

/** Create a role (Administrator only, D-001). Admin-only permissions are refused by the schema. */
export const POST = handler(async (req) => {
  const me = await requireAdmin();
  const body = await parseBody(req, roleCreateSchema);
  const exists = await prisma.role.findUnique({ where: { name: body.name } });
  if (exists) throw new ApiError(409, "A role with this name already exists.");
  const role = await prisma.$transaction(async (tx) => {
    const r = await tx.role.create({
      data: {
        name: body.name,
        description: body.description,
        color: body.color ?? "#2563eb",
        permissions: { create: body.permissions.map((permission) => ({ permission })) },
      },
    });
    await audit({ actor: me, action: "role.create", targetType: "role", targetId: r.id, summary: `Created role ${r.name}`, meta: { permissions: body.permissions }, ip: clientIp(req) }, tx);
    return r;
  });
  invalidateTags("roles");
  return json({ role: { id: role.id, name: role.name } }, { status: 201 });
});
