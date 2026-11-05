import { describe, expect, it } from "vitest";
import { GET as listEntries, POST as createEntry } from "@/app/api/time-entries/route";
import { POST as startTimer } from "@/app/api/time-entries/start/route";
import { POST as stopTimer } from "@/app/api/time-entries/[id]/stop/route";
import { POST as bulkCreate } from "@/app/api/time-entries/bulk/route";
import { prisma } from "@/lib/prisma";
import { call } from "../helpers/http";
import { makeUser, signIn } from "../helpers/factories";
import { makeEntry, makeProject } from "../helpers/entries";

const H = 3600_000;
/** A fixed past window so "end can't be in the future" never interferes. */
const BASE = Date.parse("2026-10-01T09:00:00.000Z");
const at = (ms: number) => new Date(BASE + ms).toISOString();

describe("manual entries: range rules (test plan 1)", () => {
  it.each([
    ["exactly 24 h", 24 * H, 201],
    ["24 h + 1 s", 24 * H + 1000, 400],
    ["1 s", 1000, 201],
    ["end equal to start", 0, 400],
    ["end before start", -1000, 400],
  ])("%s → %i", async (_label, length, status) => {
    const user = await makeUser();
    await signIn(user);
    const res = await call(createEntry, "POST", "/api/time-entries", { body: { startTime: at(0), endTime: at(length) } });
    expect(res.status).toBe(status);
  });

  it("allows an end up to 60 s in the future but not 2 minutes", async () => {
    const user = await makeUser();
    await signIn(user);
    const now = Date.now();
    const ok = await call(createEntry, "POST", "/api/time-entries", { body: { startTime: new Date(now - H).toISOString(), endTime: new Date(now + 30_000).toISOString() } });
    expect(ok.status).toBe(201);
    const late = await call(createEntry, "POST", "/api/time-entries", { body: { startTime: new Date(now - 3 * H).toISOString(), endTime: new Date(now + 120_000).toISOString() } });
    expect(late.status).toBe(400);
  });
});

describe("manual entries: overlap (test plan 1)", () => {
  it("accepts an entry that touches another and rejects a 1 ms overlap", async () => {
    const user = await makeUser();
    await makeEntry(user.id, at(0), 60);
    await signIn(user);
    const touching = await call(createEntry, "POST", "/api/time-entries", { body: { startTime: at(H), endTime: at(2 * H) } });
    expect(touching.status).toBe(201);
    const overlap = await call(createEntry, "POST", "/api/time-entries", { body: { startTime: at(2 * H - 1), endTime: at(3 * H) } });
    expect(overlap.status).toBe(409);
  });

  it("doesn't treat another member's entry as an overlap", async () => {
    const [a, b] = [await makeUser(), await makeUser()];
    await makeEntry(a.id, at(0), 60);
    await signIn(b);
    const res = await call(createEntry, "POST", "/api/time-entries", { body: { startTime: at(0), endTime: at(H) } });
    expect(res.status).toBe(201);
  });

  it("an employee can't log time for someone else", async () => {
    const [a, b] = [await makeUser(), await makeUser()];
    await signIn(a);
    const res = await call(createEntry, "POST", "/api/time-entries", { body: { startTime: at(0), endTime: at(H), userId: b.id } });
    expect(res.status).toBe(403);
  });

  it("refuses an archived project", async () => {
    const user = await makeUser();
    const project = await makeProject({ isArchived: true });
    await signIn(user);
    const res = await call(createEntry, "POST", "/api/time-entries", { body: { startTime: at(0), endTime: at(H), projectId: project.id } });
    expect(res.status).toBe(409);
  });
});

describe("timers (test plan 2)", () => {
  it("start then stop records a finished entry", async () => {
    const user = await makeUser();
    await signIn(user);
    const started = await call<{ entry: { id: string; running: boolean } }>(startTimer, "POST", "/api/time-entries/start", { body: { description: "Work" } });
    expect(started.status).toBe(201);
    expect(started.body.entry.running).toBe(true);
    const stopped = await call<{ entry: { running: boolean; durationSeconds: number } }>(stopTimer, "POST", "/api/time-entries/x/stop", { params: { id: started.body.entry.id } });
    expect(stopped.status).toBe(200);
    expect(stopped.body.entry.running).toBe(false);
    expect(stopped.body.entry.durationSeconds).toBeGreaterThanOrEqual(1);
  });

  it("a second start while one runs is refused", async () => {
    const user = await makeUser();
    await signIn(user);
    expect((await call(startTimer, "POST", "/api/time-entries/start", { body: {} })).status).toBe(201);
    expect((await call(startTimer, "POST", "/api/time-entries/start", { body: {} })).status).toBe(409);
  });

  it("another member can't stop my timer", async () => {
    const [owner, other] = [await makeUser(), await makeUser()];
    await signIn(owner);
    const started = await call<{ entry: { id: string } }>(startTimer, "POST", "/api/time-entries/start", { body: {} });
    await signIn(other);
    const res = await call(stopTimer, "POST", "/api/time-entries/x/stop", { params: { id: started.body.entry.id } });
    expect(res.status).toBe(403);
  });

  it("parallel starts on real Postgres create exactly one running timer (advisory lock, R-069)", async () => {
    const user = await makeUser();
    await signIn(user);
    const results = await Promise.all(Array.from({ length: 6 }, () => call(startTimer, "POST", "/api/time-entries/start", { body: {} })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(5);
    expect(await prisma.timeEntry.count({ where: { userId: user.id, endTime: null } })).toBe(1);
  });

  it("parallel overlapping manual entries: only one is saved (R-069)", async () => {
    const user = await makeUser();
    await signIn(user);
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => call(createEntry, "POST", "/api/time-entries", { body: { startTime: at(i * 60_000), endTime: at(H + i * 60_000) } })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await prisma.timeEntry.count({ where: { userId: user.id } })).toBe(1);
  });
});

describe("bulk create", () => {
  it("atomic mode rejects the whole batch when one row overlaps another in the batch", async () => {
    const user = await makeUser();
    await signIn(user);
    const res = await call(bulkCreate, "POST", "/api/time-entries/bulk", {
      body: { entries: [{ startTime: at(0), endTime: at(H) }, { startTime: at(H / 2), endTime: at(2 * H) }] },
    });
    expect(res.status).toBe(409);
    expect(await prisma.timeEntry.count({ where: { userId: user.id } })).toBe(0);
  });

  it("non-atomic mode keeps the valid rows and reports the bad one", async () => {
    const user = await makeUser();
    await signIn(user);
    const res = await call<{ created: unknown[]; errors: { index: number }[] }>(bulkCreate, "POST", "/api/time-entries/bulk", {
      body: { atomic: false, entries: [{ startTime: at(0), endTime: at(H) }, { startTime: at(H / 2), endTime: at(2 * H) }, { startTime: at(3 * H), endTime: at(4 * H) }] },
    });
    expect(res.status).toBe(201);
    expect(res.body.created).toHaveLength(2);
    expect(res.body.errors.map((e) => e.index)).toEqual([1]);
  });
});

describe("entry list: pages, scroll, filters, all time (tracker)", () => {
  type Page = { entries: { id: string; billable: boolean; running: boolean }[]; nextCursor: string | null; total?: number; pageCount?: number };
  // What the tracker's "All time" sends: 2 Jan 2000 (local midnight, here UTC) to now.
  const ALL = `from=2000-01-02T00:00:00.000Z&to=${encodeURIComponent(new Date(Date.now() + 86400_000).toISOString())}`;

  it("numbered pages return a total and page count; pages don't overlap", async () => {
    const user = await makeUser();
    for (let i = 0; i < 7; i++) await makeEntry(user.id, at(i * 2 * H), 30, { billable: i % 2 === 0 });
    await signIn(user);
    const p1 = await call<Page>(listEntries, "GET", "/api/time-entries", { query: `?${ALL}&page=1&limit=3` });
    const p3 = await call<Page>(listEntries, "GET", "/api/time-entries", { query: `?${ALL}&page=3&limit=3` });
    expect(p1.status).toBe(200);
    expect(p1.body).toMatchObject({ total: 7, pageCount: 3 });
    expect(p1.body.entries).toHaveLength(3);
    expect(p3.body.entries).toHaveLength(1);
    expect(new Set([...p1.body.entries, ...p3.body.entries].map((e) => e.id)).size).toBe(4);
  });

  it("billable and finished filters run on the server, so totals match", async () => {
    const user = await makeUser();
    for (let i = 0; i < 4; i++) await makeEntry(user.id, at(i * 2 * H), 30, { billable: i < 3 });
    await signIn(user);
    await call(startTimer, "POST", "/api/time-entries/start", { body: {} });
    const billable = await call<Page>(listEntries, "GET", "/api/time-entries", { query: `?${ALL}&billable=billable&finished=1&page=1&limit=10` });
    expect(billable.body.total).toBe(3);
    expect(billable.body.entries.every((e) => e.billable && !e.running)).toBe(true);
    const withRunning = await call<Page>(listEntries, "GET", "/api/time-entries", { query: `?${ALL}&page=1&limit=10` });
    expect(withRunning.body.total).toBe(5);
  });

  it("'All time' is allowed for the list (no 400-day cap), but reports keep theirs", async () => {
    const user = await makeUser();
    await makeEntry(user.id, "2020-03-02T09:00:00.000Z", 60);
    await signIn(user);
    const res = await call<Page>(listEntries, "GET", "/api/time-entries", { query: `?${ALL}&limit=50` });
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(1);
  });

  it("scroll mode still pages by cursor", async () => {
    const user = await makeUser();
    for (let i = 0; i < 5; i++) await makeEntry(user.id, at(i * 2 * H), 30);
    await signIn(user);
    const first = await call<Page>(listEntries, "GET", "/api/time-entries", { query: `?${ALL}&finished=1&limit=3` });
    expect(first.body.entries).toHaveLength(3);
    expect(first.body.nextCursor).toBeTruthy();
    const second = await call<Page>(listEntries, "GET", "/api/time-entries", { query: `?${ALL}&finished=1&limit=3&cursor=${first.body.nextCursor}` });
    expect(second.body.entries).toHaveLength(2);
    expect(second.body.nextCursor).toBeNull();
  });
});
