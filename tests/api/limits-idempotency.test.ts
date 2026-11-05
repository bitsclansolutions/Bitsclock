import { afterEach, describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as createUser } from "@/app/api/users/route";
import { POST as createEntry } from "@/app/api/time-entries/route";
import { clientIp, rateLimit, __resetRateLimitsForTests } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import { call } from "../helpers/http";
import { newBrowser } from "../helpers/cookies";
import { makeAdmin, makeUser, signIn, TEST_PASSWORD } from "../helpers/factories";
import { systemRoles } from "../helpers/db";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
  __resetRateLimitsForTests();
});

describe("rate limits (R-006, R-013, R-047)", () => {
  it("a 15-minute bucket keeps its window when 1-minute buckets are swept (R-013)", async () => {
    for (let i = 0; i < 3; i++) expect((await rateLimit("t:15m", 3, 15 * 60_000)).ok).toBe(true);
    // A minute-window call elsewhere used to trim every bucket to one minute.
    await rateLimit("t:1m", 100, 60_000);
    expect((await rateLimit("t:15m", 3, 15 * 60_000)).ok).toBe(false);
  });

  it("eight wrong passwords from one place block that place, not the account everywhere (R-047)", async () => {
    const user = await makeUser();
    newBrowser();
    for (let i = 0; i < 8; i++) await call(login, "POST", "/api/auth/login", { ip: "198.51.100.7", body: { email: user.email, password: "Wrong-pass-1" } });
    expect((await call(login, "POST", "/api/auth/login", { ip: "198.51.100.7", body: { email: user.email, password: TEST_PASSWORD } })).status).toBe(429);
    // The real owner, elsewhere, still gets in.
    expect((await call(login, "POST", "/api/auth/login", { ip: "203.0.113.20", body: { email: user.email, password: TEST_PASSWORD } })).status).toBe(200);
  });

  it("an office behind one IP isn't locked out after 20 sign-ins (R-006)", async () => {
    delete process.env.LOGIN_LIMIT_PER_IP; // use the real default (300 / 15 min)
    const office = "192.0.2.50";
    const people = await Promise.all(Array.from({ length: 25 }, () => makeUser()));
    newBrowser();
    for (const p of people) {
      expect((await call(login, "POST", "/api/auth/login", { ip: office, body: { email: p.email, password: TEST_PASSWORD } })).status).toBe(200);
    }
  });

  it("LOGIN_LIMIT_PER_IP is read per request", async () => {
    process.env.LOGIN_LIMIT_PER_IP = "2";
    newBrowser();
    const statuses = [];
    for (let i = 0; i < 3; i++) statuses.push((await call(login, "POST", "/api/auth/login", { ip: "192.0.2.99", body: { email: `x${i}@example.test`, password: "Wrong-pass-1" } })).status);
    expect(statuses).toEqual([401, 401, 429]);
  });
});

describe("client IP (R-045)", () => {
  const req = (h: Record<string, string>) => new Request("http://x/", { headers: h });
  it("never trusts the left-most X-Forwarded-For entry", () => {
    delete process.env.CLIENT_IP_HEADER;
    delete process.env.VERCEL;
    expect(clientIp(req({ "x-forwarded-for": "6.6.6.6, 10.0.0.1, 198.51.100.4" }))).toBe("198.51.100.4");
  });
  it("uses the configured trusted header when set", () => {
    process.env.CLIENT_IP_HEADER = "cf-connecting-ip";
    expect(clientIp(req({ "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "6.6.6.6" }))).toBe("203.0.113.9");
  });
});

describe("idempotency (R-015, test plan 7)", () => {
  it("a replay returns the stored result without the temporary password, and nothing secret is stored", async () => {
    const { employee } = await systemRoles();
    await signIn(await makeAdmin());
    const body = { name: "Replay Person", email: "replay@example.test", roleId: employee.id };
    const headers = { "idempotency-key": "same-key-123" };
    const first = await call<{ tempPassword?: string; member: { id: string } }>(createUser, "POST", "/api/users", { body, headers });
    expect(first.status).toBe(201);
    expect(first.body.tempPassword).toBeTruthy();
    const again = await call<{ tempPassword?: string; replayNote?: string; member: { id: string } }>(createUser, "POST", "/api/users", { body, headers });
    expect(again.status).toBe(201);
    expect(again.headers.get("Idempotent-Replayed")).toBe("true");
    expect(again.body.member.id).toBe(first.body.member.id);
    expect(again.body.tempPassword).toBeUndefined();
    expect(again.body.replayNote).toBeTruthy();
    const rows = await prisma.idempotencyKey.findMany();
    expect(rows.every((r) => !r.body.includes(first.body.tempPassword!))).toBe(true);
    expect(await prisma.user.count({ where: { email: "replay@example.test" } })).toBe(1);
  });

  it("the same key with a different body is a different request", async () => {
    const user = await makeUser();
    await signIn(user);
    const headers = { "idempotency-key": "reused-key" };
    const a = await call(createEntry, "POST", "/api/time-entries", { headers, body: { startTime: "2026-02-01T09:00:00.000Z", endTime: "2026-02-01T10:00:00.000Z" } });
    const b = await call(createEntry, "POST", "/api/time-entries", { headers, body: { startTime: "2026-02-02T09:00:00.000Z", endTime: "2026-02-02T10:00:00.000Z" } });
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(b.headers.get("Idempotent-Replayed")).toBeNull();
    expect(await prisma.timeEntry.count({ where: { userId: user.id } })).toBe(2);
  });

  it("an attempt stuck 'in progress' for over a minute can be retried", async () => {
    const user = await makeUser();
    await signIn(user);
    const body = { startTime: "2026-02-03T09:00:00.000Z", endTime: "2026-02-03T10:00:00.000Z" };
    const headers = { "idempotency-key": "stuck-key" };
    // First call stores a row; turn it into a stale "in progress" row as if the server died.
    await call(createEntry, "POST", "/api/time-entries", { headers, body });
    await prisma.timeEntry.deleteMany({ where: { userId: user.id } });
    await prisma.idempotencyKey.updateMany({ data: { status: 0, body: "", createdAt: new Date(Date.now() - 2 * 60_000) } });
    const retry = await call(createEntry, "POST", "/api/time-entries", { headers, body });
    expect(retry.status).toBe(201);
    expect(await prisma.timeEntry.count({ where: { userId: user.id } })).toBe(1);
  });

  it("parallel requests with the same key run once (R-069)", async () => {
    const user = await makeUser();
    await signIn(user);
    const body = { startTime: "2026-02-04T09:00:00.000Z", endTime: "2026-02-04T10:00:00.000Z" };
    const results = await Promise.all(Array.from({ length: 4 }, () => call(createEntry, "POST", "/api/time-entries", { headers: { "idempotency-key": "parallel-key" }, body })));
    expect(results.filter((r) => r.status === 201).length).toBeGreaterThanOrEqual(1);
    expect(await prisma.timeEntry.count({ where: { userId: user.id } })).toBe(1);
  });
});

describe("request size (R-067)", () => {
  it("refuses a body over 64 KB even without a Content-Length", async () => {
    await signIn(await makeUser());
    const big = JSON.stringify({ startTime: "2026-02-05T09:00:00.000Z", endTime: "2026-02-05T10:00:00.000Z", description: "x".repeat(70 * 1024) });
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode(big));
        c.close();
      },
    });
    const req = new Request("http://localhost:3100/api/time-entries", {
      method: "POST",
      headers: { host: "localhost:3100", origin: "http://localhost:3100", "content-type": "application/json" },
      body: stream,
      // @ts-expect-error -- Node's fetch needs this for a streamed body
      duplex: "half",
    });
    const res = await createEntry(req, { params: Promise.resolve({}) } as never);
    expect(res.status).toBe(413);
  });
});

describe("health check (R-022)", () => {
  it("reports the database up without revealing anything else", async () => {
    const { GET } = await import("@/app/api/health/route");
    const res = await call<{ ok: boolean; database: string; redis: string }>(GET, "GET", "/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, database: "up", redis: "not configured" });
    expect(Object.keys(res.body).sort()).toEqual(["at", "database", "ok", "redis"]);
  });
});
