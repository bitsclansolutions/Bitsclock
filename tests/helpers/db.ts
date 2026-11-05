import { prisma } from "@/lib/prisma";
import { ADMIN_ROLE_NAME, ALL_PERMISSIONS, DEFAULT_EMPLOYEE_PERMISSIONS, EMPLOYEE_ROLE_NAME } from "@/lib/permissions";
import { __resetCacheForTests } from "@/lib/server-cache";
import { __resetRateLimitsForTests } from "@/lib/rate-limit";

/**
 * Empties every application table (the safety check in scripts/test-env.mjs has
 * already confirmed this is a local *_test database), clears in-process caches and
 * rate-limit counters, and recreates the two system roles.
 */
export async function resetDatabase() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/@(localhost|127\.0\.0\.1|\[::1\]):\d+\/[^/?]+_test(\?|$)/.test(url)) {
    throw new Error("resetDatabase refused: DATABASE_URL is not a local *_test database.");
  }
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) {
    const list = tables.map((t) => `"public"."${t.tablename.replace(/"/g, '""')}"`).join(", ");
    await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
  }
  __resetCacheForTests();
  __resetRateLimitsForTests();
  await seedSystemRoles();
}

export async function seedSystemRoles() {
  const admin = await prisma.role.create({
    data: {
      name: ADMIN_ROLE_NAME,
      description: "Full access to everything.",
      color: "#0f172a",
      isSystem: true,
      permissions: { create: ALL_PERMISSIONS.map((permission) => ({ permission })) },
    },
  });
  const employee = await prisma.role.create({
    data: {
      name: EMPLOYEE_ROLE_NAME,
      description: "Tracks their own time.",
      color: "#0d9488",
      isSystem: true,
      permissions: { create: DEFAULT_EMPLOYEE_PERMISSIONS.map((permission) => ({ permission })) },
    },
  });
  return { admin, employee };
}

export async function systemRoles() {
  const [admin, employee] = await Promise.all([
    prisma.role.findUniqueOrThrow({ where: { name: ADMIN_ROLE_NAME } }),
    prisma.role.findUniqueOrThrow({ where: { name: EMPLOYEE_ROLE_NAME } }),
  ]);
  return { admin, employee };
}
