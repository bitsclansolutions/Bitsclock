import { describe, expect, it } from "vitest";
import { POST as refresh } from "@/app/api/auth/refresh/route";
import { GET as me } from "@/app/api/auth/me/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as listSessions } from "@/app/api/auth/sessions/route";
import { DELETE as revokeSession } from "@/app/api/auth/sessions/[id]/route";
import { PATCH as changePassword } from "@/app/api/auth/password/route";
import { POST as login } from "@/app/api/auth/login/route";
import { REFRESH_COOKIE } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { __resetCacheForTests } from "@/lib/server-cache";
import { call } from "../helpers/http";
import { newBrowser, switchJar } from "../helpers/cookies";
import { makeUser, signIn, TEST_PASSWORD } from "../helpers/factories";

/** Pretend the last rotation happened `ms` ago. */
const rotatedAgo = (userId: string, ms: number) => prisma.refreshSession.updateMany({ where: { userId }, data: { rotatedAt: new Date(Date.now() - ms) } });

describe("refresh rotation (test plan 6, D-003)", () => {
  it("rotates after 2 minutes; the old token still works inside the 90 s grace window", async () => {
    const user = await makeUser();
    const jar = await signIn(user);
    const oldJar = jar.clone();
    await rotatedAgo(user.id, 3 * 60_000);
    expect((await call(refresh, "POST", "/api/auth/refresh")).status).toBe(200);
    expect(jar.get(REFRESH_COOKIE)!.value).not.toBe(oldJar.get(REFRESH_COOKIE)!.value);
    switchJar(oldJar);
    expect((await call(refresh, "POST", "/api/auth/refresh")).status).toBe(200);
  });

  it("an old token replayed after the grace window revokes the session (reuse detection, R-024)", async () => {
    const user = await makeUser();
    const jar = await signIn(user);
    const stolen = jar.clone();
    await rotatedAgo(user.id, 3 * 60_000);
    await call(refresh, "POST", "/api/auth/refresh");
    // 91 s later someone presents the replaced token.
    await rotatedAgo(user.id, 91_000);
    switchJar(stolen);
    expect((await call(refresh, "POST", "/api/auth/refresh")).status).toBe(401);
    expect(await prisma.refreshSession.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
    // The legitimate browser is signed out too: the session is gone for everyone.
    switchJar(jar);
    expect((await call(refresh, "POST", "/api/auth/refresh")).status).toBe(401);
  });

  it("parallel refreshes from one browser never sign it out (R-012, R-069 on real Postgres)", async () => {
    const user = await makeUser();
    await signIn(user);
    await rotatedAgo(user.id, 3 * 60_000);
    const results = await Promise.all(Array.from({ length: 6 }, () => call(refresh, "POST", "/api/auth/refresh")));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200, 200]);
    const s = await prisma.refreshSession.findFirstOrThrow({ where: { userId: user.id } });
    expect(s.revokedAt).toBeNull();
  });

  it("a tokenVersion bump alone ends every refresh session (D-003)", async () => {
    const user = await makeUser();
    await signIn(user);
    await prisma.user.update({ where: { id: user.id }, data: { tokenVersion: { increment: 1 } } });
    __resetCacheForTests();
    expect((await call(refresh, "POST", "/api/auth/refresh")).status).toBe(401);
  });

  it("refresh fails for a deactivated member", async () => {
    const user = await makeUser();
    await signIn(user);
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
    expect((await call(refresh, "POST", "/api/auth/refresh")).status).toBe(401);
  });
});

describe("signing out (R-060)", () => {
  it("sign out everywhere kills other devices' access tokens immediately", async () => {
    const user = await makeUser();
    const laptop = await signIn(user);
    const phone = await signIn(user);
    switchJar(phone);
    expect((await call(me, "GET", "/api/auth/me")).status).toBe(200);
    switchJar(laptop);
    expect((await call(logout, "POST", "/api/auth/logout", { body: { everywhere: true } })).status).toBe(200);
    switchJar(phone);
    expect((await call(me, "GET", "/api/auth/me")).status).toBe(401);
    expect((await call(refresh, "POST", "/api/auth/refresh")).status).toBe(401);
  });

  it("signing out one device from another kills that device's access token immediately", async () => {
    const user = await makeUser();
    const phone = await signIn(user);
    const laptop = await signIn(user);
    const list = await call<{ sessions: { id: string; current: boolean }[] }>(listSessions, "GET", "/api/auth/sessions");
    const other = list.body.sessions.find((s) => !s.current)!;
    expect((await call(revokeSession, "DELETE", "/api/auth/sessions/x", { params: { id: other.id } })).status).toBe(200);
    switchJar(phone);
    expect((await call(me, "GET", "/api/auth/me")).status).toBe(401);
    switchJar(laptop);
    expect((await call(me, "GET", "/api/auth/me")).status).toBe(200);
  });

  it("a password change ends other devices and keeps this one signed in", async () => {
    const user = await makeUser();
    const other = await signIn(user);
    const here = await signIn(user);
    const res = await call(changePassword, "PATCH", "/api/auth/password", { body: { currentPassword: TEST_PASSWORD, newPassword: "Brand-new-pass-9" } });
    expect(res.status).toBe(200);
    expect((await call(me, "GET", "/api/auth/me")).status).toBe(200);
    switchJar(other);
    expect((await call(me, "GET", "/api/auth/me")).status).toBe(401);
    expect((await call(refresh, "POST", "/api/auth/refresh")).status).toBe(401);
    switchJar(here);
    newBrowser();
    expect((await call(login, "POST", "/api/auth/login", { body: { email: user.email, password: "Brand-new-pass-9" } })).status).toBe(200);
  });
});
