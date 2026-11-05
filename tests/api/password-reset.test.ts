import { describe, expect, it } from "vitest";
import { POST as forgot } from "@/app/api/auth/forgot/route";
import { POST as reset } from "@/app/api/auth/reset/route";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as adminReset } from "@/app/api/users/[id]/reset-password/route";
import { PATCH as patchUser } from "@/app/api/users/[id]/route";
import { issueResetCode, RESET_MAX_ATTEMPTS } from "@/lib/password-reset";
import { prisma } from "@/lib/prisma";
import { call } from "../helpers/http";
import { newBrowser } from "../helpers/cookies";
import { makeAdmin, makeUser, signIn } from "../helpers/factories";

const NEW_PASSWORD = "Fresh-pass-2026";
const wrong = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, "0");
const waitFor = async (check: () => Promise<boolean>, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
};

describe("forgot password (test plan 9)", () => {
  it("answers the same for a real and an unknown address, and only the real one gets a code", async () => {
    const user = await makeUser();
    newBrowser();
    const known = await call(forgot, "POST", "/api/auth/forgot", { body: { email: user.email } });
    const unknown = await call(forgot, "POST", "/api/auth/forgot", { body: { email: "nobody@example.test" } });
    expect(known.status).toBe(200);
    expect(unknown.body).toEqual(known.body);
    // The code is issued after the response (R-044).
    expect(await waitFor(async () => (await prisma.passwordReset.count({ where: { userId: user.id } })) === 1)).toBe(true);
  });
});

describe("reset with a code (D-003, R-004)", () => {
  it("sets the password, revokes every session, and the code works only once", async () => {
    const user = await makeUser();
    await signIn(user);
    const { code } = await issueResetCode(user.id);
    newBrowser();
    expect((await call(reset, "POST", "/api/auth/reset", { body: { email: user.email, code, newPassword: NEW_PASSWORD } })).status).toBe(200);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.tokenVersion).toBe(1);
    expect(await prisma.refreshSession.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
    expect((await call(login, "POST", "/api/auth/login", { body: { email: user.email, password: NEW_PASSWORD } })).status).toBe(200);
    newBrowser();
    expect((await call(reset, "POST", "/api/auth/reset", { body: { email: user.email, code, newPassword: "Another-pass-1" } })).status).toBe(400);
  });

  it(`the ${RESET_MAX_ATTEMPTS}th wrong guess locks the code; the right one is refused afterwards`, async () => {
    const user = await makeUser();
    const { code } = await issueResetCode(user.id);
    newBrowser();
    for (let i = 0; i < RESET_MAX_ATTEMPTS; i++) {
      expect((await call(reset, "POST", "/api/auth/reset", { body: { email: user.email, code: wrong(code), newPassword: NEW_PASSWORD } })).status).toBe(400);
    }
    const after = await call<{ error: string }>(reset, "POST", "/api/auth/reset", { body: { email: user.email, code, newPassword: NEW_PASSWORD } });
    expect(after.status).toBe(400);
    expect(after.body.error).toMatch(/Too many wrong codes/);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).tokenVersion).toBe(0);
  });

  it("parallel correct submissions: exactly one succeeds (R-043, R-069 on real Postgres)", async () => {
    const user = await makeUser();
    const { code } = await issueResetCode(user.id);
    newBrowser();
    const results = await Promise.all(Array.from({ length: 4 }, (_, i) => call(reset, "POST", "/api/auth/reset", { body: { email: user.email, code, newPassword: `Parallel-pass-${i}` } })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).tokenVersion).toBe(1);
  });

  it("parallel wrong guesses never exceed the attempt cap (R-043, R-069)", async () => {
    const user = await makeUser();
    const { code } = await issueResetCode(user.id);
    newBrowser();
    await Promise.all(Array.from({ length: 9 }, () => call(reset, "POST", "/api/auth/reset", { body: { email: user.email, code: wrong(code), newPassword: NEW_PASSWORD } })));
    const row = await prisma.passwordReset.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.attempts).toBe(RESET_MAX_ATTEMPTS);
  });
});

describe("pending codes die with every other security change (R-065)", () => {
  it("admin reset, email change and deactivation each delete unused reset codes", async () => {
    const admin = await makeAdmin();
    const [a, b, c] = [await makeUser(), await makeUser(), await makeUser()];
    for (const u of [a, b, c]) await issueResetCode(u.id);
    await signIn(admin);
    await call(adminReset, "POST", "/api/users/x/reset-password", { params: { id: a.id }, body: {} });
    await call(patchUser, "PATCH", "/api/users/x", { params: { id: b.id }, body: { email: "changed@example.test" } });
    await call(patchUser, "PATCH", "/api/users/x", { params: { id: c.id }, body: { isActive: false } });
    expect(await prisma.passwordReset.count({ where: { userId: { in: [a.id, b.id, c.id] } } })).toBe(0);
  });
});
