import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import type { Permission } from "@/lib/permissions";
import { startSession } from "@/lib/auth";
import { systemRoles } from "./db";
import { newBrowser, type CookieJar } from "./cookies";

/** Password every factory user gets unless a test sets one. Synthetic, test-only. */
export const TEST_PASSWORD = "Test-pass-123";
// Cost 4 keeps the suite fast; bcrypt.compare works with any cost.
const TEST_HASH = bcrypt.hashSync(TEST_PASSWORD, 4);

const unique = () => randomUUID().slice(0, 8);

export async function makeRole(permissions: Permission[], name = `Role ${unique()}`) {
  return prisma.role.create({
    data: { name, color: "#2563eb", permissions: { create: permissions.map((permission) => ({ permission })) } },
  });
}

type UserOpts = { role?: "admin" | "employee" | { id: string }; name?: string; email?: string; password?: string; isActive?: boolean };

export async function makeUser(opts: UserOpts = {}) {
  const { admin, employee } = await systemRoles();
  const roleId = opts.role === "admin" ? admin.id : opts.role === undefined || opts.role === "employee" ? employee.id : opts.role.id;
  const id = unique();
  return prisma.user.create({
    data: {
      name: opts.name ?? `Test User ${id}`,
      email: opts.email ?? `user-${id}@example.test`,
      passwordHash: opts.password ? await bcrypt.hash(opts.password, 4) : TEST_HASH,
      roleId,
      isActive: opts.isActive ?? true,
    },
  });
}

export const makeAdmin = (opts: Omit<UserOpts, "role"> = {}) => makeUser({ ...opts, role: "admin" });

/** A fresh browser signed in as `user` (real access JWT + refresh session). Becomes the current jar. */
export async function signIn(user: { id: string }, opts: { remember?: boolean } = {}): Promise<CookieJar> {
  const jar = newBrowser();
  const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { id: true, tokenVersion: true } });
  await startSession(fresh, { remember: opts.remember ?? false, userAgent: "vitest", ip: "127.0.0.1" });
  return jar;
}
