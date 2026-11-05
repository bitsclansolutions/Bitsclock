import { afterAll, beforeAll, vi } from "vitest";
import { cookieJar } from "../helpers/cookies";

// Route handlers read cookies through next/headers, which only works inside a real
// Next request. Tests swap in an in-memory jar they control (see helpers/cookies.ts).
vi.mock("next/headers", () => ({
  cookies: async () => cookieJar(),
  headers: async () => new Headers(),
}));

// Each test file starts from an empty database with only the two system roles.
beforeAll(async () => {
  const { resetDatabase } = await import("../helpers/db");
  await resetDatabase();
});

afterAll(async () => {
  const { prisma } = await import("@/lib/prisma");
  await prisma.$disconnect();
});
