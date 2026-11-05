import { prisma } from "./prisma";
import { ADMIN_ROLE_NAME, ALL_PERMISSIONS } from "./permissions";

export type RoleDTO = {
  id: string;
  name: string;
  description: string;
  color: string;
  isSystem: boolean;
  isAdmin: boolean;
  permissions: string[];
  userCount: number;
  createdAt: string;
};

export async function listRoles(): Promise<RoleDTO[]> {
  const roles = await prisma.role.findMany({
    include: { permissions: true, _count: { select: { users: true } } },
    orderBy: [{ isSystem: "desc" }, { createdAt: "asc" }],
  });
  return roles.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description ?? "",
    color: r.color,
    isSystem: r.isSystem,
    isAdmin: r.name === ADMIN_ROLE_NAME,
    permissions: r.name === ADMIN_ROLE_NAME ? [...ALL_PERMISSIONS] : r.permissions.map((p) => p.permission),
    userCount: r._count.users,
    createdAt: r.createdAt.toISOString(),
  }));
}
