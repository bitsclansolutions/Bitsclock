import { describe, expect, it } from "vitest";
import { POST as createEntry, GET as listEntriesRoute } from "@/app/api/time-entries/route";
import { PATCH as patchEntry, DELETE as deleteEntryRoute } from "@/app/api/time-entries/[id]/route";
import { POST as startTimer } from "@/app/api/time-entries/start/route";
import { POST as stopTimer } from "@/app/api/time-entries/[id]/stop/route";
import { GET as activeRoute } from "@/app/api/time-entries/active/route";
import { DELETE as bulkDelete } from "@/app/api/time-entries/bulk/route";
import { PATCH as setWorkspace } from "@/app/api/workspace/route";
import { DELETE as deleteProject } from "@/app/api/projects/[id]/route";
import { GET as listProjects } from "@/app/api/projects/route";
import { prisma } from "@/lib/prisma";
import { entrySql, entryWhere, type EntryFilter } from "@/lib/entry-filter";
import { Prisma } from "@/lib/prisma";
import { call } from "../helpers/http";
import { makeAdmin, makeRole, makeUser, signIn } from "../helpers/factories";
import { makeEntry, makeProject } from "../helpers/entries";

const H = 3600_000;
const iso = (ms: number) => new Date(ms).toISOString();

describe("24 h auto-stop (D-005, R-014)", () => {
  it("a timer left running 30 h is closed at start + 24 h and flagged when read", async () => {
    const user = await makeUser();
    const start = new Date(Date.now() - 30 * H);
    const e = await prisma.timeEntry.create({ data: { userId: user.id, startTime: start } });
    await signIn(user);
    const res = await call<{ entry: unknown }>(activeRoute, "GET", "/api/time-entries/active");
    expect(res.body.entry).toBeNull();
    const row = await prisma.timeEntry.findUniqueOrThrow({ where: { id: e.id } });
    expect(row.endTime?.getTime()).toBe(start.getTime() + 24 * H);
    expect(row.autoStopped).toBe(true);
    expect(row.durationSeconds).toBe(24 * 3600);
  });

  it("stopping an overdue timer also caps it; starting a new one closes the overdue one first", async () => {
    const user = await makeUser();
    const old = await prisma.timeEntry.create({ data: { userId: user.id, startTime: new Date(Date.now() - 26 * H) } });
    await signIn(user);
    const started = await call(startTimer, "POST", "/api/time-entries/start", { body: {} });
    expect(started.status).toBe(201);
    const closed = await prisma.timeEntry.findUniqueOrThrow({ where: { id: old.id } });
    expect(closed.autoStopped).toBe(true);

    const other = await makeUser();
    const late = await prisma.timeEntry.create({ data: { userId: other.id, startTime: new Date(Date.now() - 40 * H) } });
    await signIn(other);
    const stopped = await call<{ entry: { durationSeconds: number; autoStopped: boolean } }>(stopTimer, "POST", "/api/time-entries/x/stop", { params: { id: late.id } });
    expect(stopped.body.entry.durationSeconds).toBe(24 * 3600);
    expect(stopped.body.entry.autoStopped).toBe(true);
  });

  it("correcting the end time clears the flag", async () => {
    const user = await makeUser();
    const start = Date.now() - 48 * H;
    const e = await prisma.timeEntry.create({ data: { userId: user.id, startTime: new Date(start), endTime: new Date(start + 24 * H), durationSeconds: 86400, autoStopped: true } });
    await signIn(user);
    const res = await call<{ entry: { autoStopped: boolean } }>(patchEntry, "PATCH", "/api/time-entries/x", { params: { id: e.id }, body: { endTime: iso(start + 8 * H) } });
    expect(res.status).toBe(200);
    expect(res.body.entry.autoStopped).toBe(false);
  });
});

describe("locked periods (D-005, R-023)", () => {
  async function lockAt(ms: number) {
    await signIn(await makeAdmin());
    expect((await call(setWorkspace, "PATCH", "/api/workspace", { body: { lockDate: iso(ms) } })).status).toBe(200);
  }

  it("members can't create, edit or delete entries before the lock date; the Administrator can", async () => {
    const lock = Date.now() - 10 * 86400_000;
    const user = await makeUser();
    const before = await makeEntry(user.id, iso(lock - 2 * 86400_000), 60);
    await lockAt(lock);
    await signIn(user);
    expect((await call(createEntry, "POST", "/api/time-entries", { body: { startTime: iso(lock - 86400_000), endTime: iso(lock - 86400_000 + H) } })).status).toBe(403);
    expect((await call(patchEntry, "PATCH", "/api/time-entries/x", { params: { id: before.id }, body: { description: "changed" } })).status).toBe(403);
    expect((await call(deleteEntryRoute, "DELETE", "/api/time-entries/x", { params: { id: before.id } })).status).toBe(403);
    // Moving an unlocked entry into the locked period is refused too.
    const after = await makeEntry(user.id, iso(lock + 86400_000), 60);
    expect((await call(patchEntry, "PATCH", "/api/time-entries/x", { params: { id: after.id }, body: { startTime: iso(lock - 3 * 86400_000), endTime: iso(lock - 3 * 86400_000 + H) } })).status).toBe(403);
    // Bulk delete skips the locked one.
    const bulk = await call<{ deleted: number; skipped: number }>(bulkDelete, "DELETE", "/api/time-entries/bulk", { body: { ids: [before.id, after.id] } });
    expect(bulk.body).toEqual({ deleted: 1, skipped: 1 });
    // The Administrator can still correct invoiced time.
    await signIn(await makeAdmin());
    expect((await call(deleteEntryRoute, "DELETE", "/api/time-entries/x", { params: { id: before.id } })).status).toBe(200);
  });

  it("only the Administrator sets the lock date, and never in the future", async () => {
    await signIn(await makeUser({ role: await makeRole(["time.manage_all", "reports.view_all"]) }));
    expect((await call(setWorkspace, "PATCH", "/api/workspace", { body: { lockDate: iso(Date.now() - 86400_000) } })).status).toBe(403);
    await signIn(await makeAdmin());
    expect((await call(setWorkspace, "PATCH", "/api/workspace", { body: { lockDate: iso(Date.now() + 2 * 86400_000) } })).status).toBe(400);
    expect((await call(setWorkspace, "PATCH", "/api/workspace", { body: { lockDate: null } })).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: "workspace.lock_date" } })).toBeGreaterThan(0);
  });
});

describe("billable follows the project (D-005, R-023)", () => {
  const range = () => ({ startTime: iso(Date.now() - 3 * H), endTime: iso(Date.now() - 2 * H) });

  it("an employee gets the project default and can't override it", async () => {
    const lunch = await makeProject({ billable: false, kind: "activity" });
    const user = await makeUser();
    await signIn(user);
    const ok = await call<{ entry: { billable: boolean } }>(createEntry, "POST", "/api/time-entries", { body: { ...range(), projectId: lunch.id } });
    expect(ok.body.entry.billable).toBe(false);
    const sneaky = await call(createEntry, "POST", "/api/time-entries", { body: { startTime: iso(Date.now() - 5 * H), endTime: iso(Date.now() - 4 * H), projectId: lunch.id, billable: true } });
    expect(sneaky.status).toBe(403);
  });

  it("time.manage_all can override; re-sending the current value is not an override", async () => {
    const client = await makeProject({ billable: true });
    const manager = await makeUser({ role: await makeRole(["time.track", "time.manage_all"]) });
    await signIn(manager);
    const res = await call<{ entry: { id: string; billable: boolean } }>(createEntry, "POST", "/api/time-entries", { body: { ...range(), projectId: client.id, billable: false } });
    expect(res.status).toBe(201);
    expect(res.body.entry.billable).toBe(false);
    // An employee who owns an overridden entry can still edit its description while sending the current flag.
    const employee = await makeUser();
    const e = await prisma.timeEntry.create({ data: { userId: employee.id, projectId: client.id, billable: false, startTime: new Date(Date.now() - 7 * H), endTime: new Date(Date.now() - 6 * H), durationSeconds: 3600 } });
    await signIn(employee);
    expect((await call(patchEntry, "PATCH", "/api/time-entries/x", { params: { id: e.id }, body: { description: "notes", billable: false } })).status).toBe(200);
  });
});

describe("project must stay usable when time is added (R-061)", () => {
  it("can't extend an entry or stop a timer on an archived project", async () => {
    const user = await makeUser();
    const p = await makeProject();
    const e = await prisma.timeEntry.create({ data: { userId: user.id, projectId: p.id, startTime: new Date(Date.now() - 5 * H), endTime: new Date(Date.now() - 4 * H), durationSeconds: 3600 } });
    const t = await prisma.timeEntry.create({ data: { userId: user.id, projectId: p.id, startTime: new Date(Date.now() - H) } });
    await prisma.project.update({ where: { id: p.id }, data: { isArchived: true } });
    await signIn(user);
    expect((await call(patchEntry, "PATCH", "/api/time-entries/x", { params: { id: e.id }, body: { endTime: iso(Date.now() - 3 * H) } })).status).toBe(409);
    // Shortening is fine.
    expect((await call(patchEntry, "PATCH", "/api/time-entries/x", { params: { id: e.id }, body: { endTime: iso(Date.now() - 4.5 * H) } })).status).toBe(200);
    expect((await call(stopTimer, "POST", "/api/time-entries/x/stop", { params: { id: t.id } })).status).toBe(409);
  });
});

describe("the database enforces the core rules on its own (D-006, R-021)", () => {
  it("rejects end <= start, a second running timer, and deleting a member or project with time", async () => {
    const user = await makeUser();
    const now = new Date();
    await expect(prisma.timeEntry.create({ data: { userId: user.id, startTime: now, endTime: now, durationSeconds: 0 } })).rejects.toThrow();
    await prisma.timeEntry.create({ data: { userId: user.id, startTime: new Date(Date.now() - H) } });
    await expect(prisma.timeEntry.create({ data: { userId: user.id, startTime: new Date() } })).rejects.toThrow();
    await expect(prisma.user.delete({ where: { id: user.id } })).rejects.toThrow();
    const p = await makeProject();
    await makeEntry(user.id, iso(Date.now() - 50 * H), 30, { projectId: p.id });
    await expect(prisma.project.delete({ where: { id: p.id } })).rejects.toThrow();
  });

  it("deleting a project with entries answers 409 'archive instead'", async () => {
    const user = await makeUser();
    const p = await makeProject();
    await makeEntry(user.id, iso(Date.now() - 50 * H), 30, { projectId: p.id });
    await signIn(await makeAdmin());
    expect((await call(deleteProject, "DELETE", "/api/projects/x", { params: { id: p.id } })).status).toBe(409);
  });
});

describe("shared entry filter (R-031)", () => {
  it("the Prisma and SQL forms select exactly the same entries", async () => {
    const [a, b] = [await makeUser(), await makeUser()];
    const p = await makeProject();
    await makeEntry(a.id, "2026-06-01T09:00:00Z", 60, { billable: true, projectId: p.id, description: "Client 50% call" });
    await makeEntry(a.id, "2026-06-01T11:00:00Z", 30, { billable: false, description: "lunch" });
    await makeEntry(b.id, "2026-06-02T09:00:00Z", 45, { billable: true, projectId: p.id, description: "review_notes" });
    await prisma.timeEntry.create({ data: { userId: b.id, startTime: new Date("2026-06-02T10:00:00Z"), endTime: new Date("2026-06-03T10:00:00Z"), durationSeconds: 86400, autoStopped: true } });
    const base = { from: new Date("2026-06-01T00:00:00Z"), to: new Date("2026-06-04T00:00:00Z") };
    const cases: EntryFilter[] = [
      base,
      { ...base, userIds: [a.id] },
      { ...base, userIds: [] },
      { ...base, projectId: p.id },
      { ...base, projectId: "none" },
      { ...base, billable: "billable" },
      { ...base, billable: "non_billable" },
      { ...base, q: "50%" },
      { ...base, q: "w_n" },
      { ...base, q: "LUNCH" },
      { ...base, autoStoppedOnly: true },
    ];
    for (const f of cases) {
      const viaPrisma = (await prisma.timeEntry.findMany({ where: entryWhere(f), select: { id: true } })).map((r) => r.id).sort();
      const viaSql = (await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT e.id FROM bc_time_entries e WHERE ${entrySql(f)}`)).map((r) => r.id).sort();
      expect(viaSql, JSON.stringify({ ...f, from: undefined, to: undefined })).toEqual(viaPrisma);
    }
  });
});

describe("entry list paging (R-025)", () => {
  it("walks every entry exactly once with the cursor", async () => {
    const user = await makeUser();
    for (let i = 0; i < 7; i++) await makeEntry(user.id, iso(Date.parse("2026-07-01T08:00:00Z") + i * H), 30);
    // Two entries at the same instant must not be skipped or repeated across a page edge.
    await makeEntry(user.id, iso(Date.parse("2026-07-01T08:00:00Z") + 3 * H + 1800_000), 10);
    await signIn(user);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const res: { body: { entries: { id: string }[]; nextCursor: string | null } } = await call(listEntriesRoute, "GET", "/api/time-entries", {
        query: "?" + new URLSearchParams({ from: "2026-07-01T00:00:00.000Z", to: "2026-07-02T00:00:00.000Z", limit: "3", ...(cursor ? { cursor } : {}) }).toString(),
      });
      seen.push(...res.body.entries.map((e) => e.id));
      cursor = res.body.nextCursor;
    } while (cursor);
    expect(seen).toHaveLength(8);
    expect(new Set(seen).size).toBe(8);
  });
});

describe("project list for members without projects.view", () => {
  it("a member who only tracks time sees the projects they were added to (and open ones), nothing else", async () => {
    const role = await makeRole(["time.track"]);
    const user = await makeUser({ role });
    const mine = await makeProject({ memberMode: "selected" });
    await prisma.project.update({ where: { id: mine.id }, data: { members: { create: { userId: user.id } } } });
    const open = await makeProject({ memberMode: "all" });
    const notMine = await makeProject({ memberMode: "selected" });
    await signIn(user);
    const res = await call<{ projects: { id: string; canLog: boolean; memberIds: string[] }[] }>(listProjects, "GET", "/api/projects");
    expect(res.status).toBe(200);
    const ids = res.body.projects.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining([mine.id, open.id]));
    expect(ids).not.toContain(notMine.id);
    expect(res.body.projects.find((p) => p.id === mine.id)?.canLog).toBe(true);
    // No member list without users.view: only the caller's own id.
    expect(res.body.projects.find((p) => p.id === mine.id)?.memberIds).toEqual([user.id]);
  });

  it("a project they were removed from stays listed for reports, but can't take new time", async () => {
    const role = await makeRole(["reports.view_own"]);
    const user = await makeUser({ role });
    const former = await makeProject({ memberMode: "selected" });
    await makeEntry(user.id, iso(Date.now() - 48 * H), 60, { projectId: former.id });
    await signIn(user);
    const res = await call<{ projects: { id: string; canLog: boolean }[] }>(listProjects, "GET", "/api/projects?includeArchived=1");
    expect(res.status).toBe(200);
    expect(res.body.projects.find((p) => p.id === former.id)?.canLog).toBe(false);
  });

  it("a role with none of the list permissions still gets 403", async () => {
    const role = await makeRole(["users.view"]);
    await signIn(await makeUser({ role }));
    expect((await call(listProjects, "GET", "/api/projects")).status).toBe(403);
  });
});
