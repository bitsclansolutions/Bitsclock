import { describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/auth/login/route";
import { GET as me } from "@/app/api/auth/me/route";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "@/lib/auth";
import { call } from "../helpers/http";
import { newBrowser } from "../helpers/cookies";
import { makeUser, TEST_PASSWORD } from "../helpers/factories";

describe("POST /api/auth/login", () => {
  it("signs in with the right password and sets both cookies", async () => {
    const user = await makeUser();
    const jar = newBrowser();
    const res = await call(login, "POST", "/api/auth/login", { body: { email: user.email, password: TEST_PASSWORD } });
    expect(res.status).toBe(200);
    expect(jar.get(ACCESS_COOKIE)).toBeDefined();
    expect(jar.get(REFRESH_COOKIE)).toBeDefined();
    const who = await call<{ user: { id: string } }>(me, "GET", "/api/auth/me");
    expect(who.body.user.id).toBe(user.id);
  });

  it("rejects a wrong password with 401 and no cookies", async () => {
    const user = await makeUser();
    const jar = newBrowser();
    const res = await call(login, "POST", "/api/auth/login", { body: { email: user.email, password: "Wrong-pass-1" } });
    expect(res.status).toBe(401);
    expect(jar.get(ACCESS_COOKIE)).toBeUndefined();
  });

  it("gives an unknown email exactly the same 401 as a wrong password (no enumeration, D-010)", async () => {
    const user = await makeUser();
    newBrowser();
    const unknown = await call(login, "POST", "/api/auth/login", { body: { email: "nobody@example.test", password: TEST_PASSWORD } });
    const wrong = await call(login, "POST", "/api/auth/login", { body: { email: user.email, password: "Wrong-pass-1" } });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
    expect(unknown.body).toEqual({ error: "That email and password don't match. Check both, or reset your password." });
  });

  it("refuses a deactivated account with 403, but only once the password is right", async () => {
    const user = await makeUser({ isActive: false });
    newBrowser();
    const res = await call<{ error: string }>(login, "POST", "/api/auth/login", { body: { email: user.email, password: TEST_PASSWORD } });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/deactivated/);
    const wrong = await call(login, "POST", "/api/auth/login", { body: { email: user.email, password: "Wrong-pass-1" } });
    expect(wrong.status).toBe(401);
  });

  it("tells a locked-out user how long to wait", async () => {
    const user = await makeUser();
    newBrowser();
    const attempt = () => call<{ error: string }>(login, "POST", "/api/auth/login", { ip: "198.51.100.40", body: { email: user.email, password: "Wrong-pass-1" } });
    let res = await attempt();
    for (let i = 0; i < 10 && res.status !== 429; i++) res = await attempt();
    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/wait (about a minute|\d+ minutes)/);
  });

  it("refuses a cross-site request", async () => {
    const user = await makeUser();
    newBrowser();
    const res = await call(login, "POST", "/api/auth/login", {
      body: { email: user.email, password: TEST_PASSWORD },
      headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
    });
    expect(res.status).toBe(403);
  });
});
