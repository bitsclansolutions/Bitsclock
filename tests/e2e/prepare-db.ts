/**
 * Empties the local test database and creates the two system roles, one admin and one
 * employee with synthetic test-only passwords. Run by tests/e2e/global-setup.ts via tsx
 * (the generated Prisma client is an ES module, which Playwright's loader can't import).
 */
import bcrypt from "bcryptjs";
import { createPrismaClient } from "../../src/lib/prisma";
import { ADMIN_ROLE_NAME, ALL_PERMISSIONS, DEFAULT_EMPLOYEE_PERMISSIONS, EMPLOYEE_ROLE_NAME } from "../../src/lib/permissions";
import { assertSafeDatabase } from "../../scripts/test-env.mjs";
import { E2E_ADMIN, E2E_EMPLOYEE } from "./accounts";

async function main() {
  assertSafeDatabase(process.env.DATABASE_URL);
  const prisma = createPrismaClient(process.env.DATABASE_URL);
  try {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    if (tables.length) await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
    const admin = await prisma.role.create({
      data: { name: ADMIN_ROLE_NAME, isSystem: true, color: "#0f172a", permissions: { create: ALL_PERMISSIONS.map((permission) => ({ permission })) } },
    });
    const employee = await prisma.role.create({
      data: { name: EMPLOYEE_ROLE_NAME, isSystem: true, color: "#0d9488", permissions: { create: DEFAULT_EMPLOYEE_PERMISSIONS.map((permission) => ({ permission })) } },
    });
    await prisma.user.create({ data: { name: "E2E Admin", email: E2E_ADMIN.email, passwordHash: await bcrypt.hash(E2E_ADMIN.password, 4), roleId: admin.id } });
    await prisma.user.create({ data: { name: "E2E Employee", email: E2E_EMPLOYEE.email, passwordHash: await bcrypt.hash(E2E_EMPLOYEE.password, 4), roleId: employee.id } });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
