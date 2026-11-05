import { describe, expect, it } from "vitest";
import { GET as report } from "@/app/api/reports/route";
import { buildReport } from "@/lib/reports";
import type { ReportResponse } from "@/app/api/reports/route";
import { call } from "../helpers/http";
import { makeRole, makeUser, signIn } from "../helpers/factories";
import { makeEntry, makeProject } from "../helpers/entries";

const q = (o: Record<string, string>) => "?" + new URLSearchParams(o).toString();

describe("report aggregation on real Postgres (test plan 4)", () => {
  it("buckets days in the report's time zone (Asia/Kolkata, +05:30)", async () => {
    const user = await makeUser();
    // 20:00 UTC on 1 March is 01:30 on 2 March in Kolkata.
    await makeEntry(user.id, "2026-03-01T20:00:00.000Z", 60);
    await makeEntry(user.id, "2026-03-01T10:00:00.000Z", 30);
    const r = await buildReport({ from: new Date("2026-03-01T00:00:00Z"), to: new Date("2026-03-03T00:00:00Z"), tz: "Asia/Kolkata", userIds: [user.id] }, { withEntries: false });
    expect(r.byDay.map((d) => [d.key, d.seconds])).toEqual([
      ["2026-03-01", 1800],
      ["2026-03-02", 3600],
    ]);
  });

  it("handles a New York DST day and a +14 zone", async () => {
    const user = await makeUser();
    // 8 March 2026 is the US spring-forward day. 04:30 UTC = 23:30 on 7 March EST.
    await makeEntry(user.id, "2026-03-08T04:30:00.000Z", 15);
    // 08:00 UTC = 04:00 EDT on 8 March (after the jump).
    await makeEntry(user.id, "2026-03-08T08:00:00.000Z", 15);
    const ny = await buildReport({ from: new Date("2026-03-07T00:00:00Z"), to: new Date("2026-03-09T00:00:00Z"), tz: "America/New_York", userIds: [user.id] }, { withEntries: false });
    expect(ny.byDay.map((d) => d.key)).toEqual(["2026-03-07", "2026-03-08"]);
    const kiri = await buildReport({ from: new Date("2026-03-07T00:00:00Z"), to: new Date("2026-03-09T00:00:00Z"), tz: "Pacific/Kiritimati", userIds: [user.id] }, { withEntries: false });
    expect(kiri.byDay.map((d) => d.key)).toEqual(["2026-03-08"]);
  });

  it("totals, billable split and per-project/member rows agree", async () => {
    const [a, b] = [await makeUser({ name: "Alpha" }), await makeUser({ name: "Bravo" })];
    const p = await makeProject({ name: "Client work" });
    await makeEntry(a.id, "2026-04-01T09:00:00Z", 120, { billable: true, projectId: p.id });
    await makeEntry(a.id, "2026-04-01T12:00:00Z", 30, { billable: false });
    await makeEntry(b.id, "2026-04-02T09:00:00Z", 60, { billable: true, projectId: p.id });
    const r = await buildReport({ from: new Date("2026-04-01T00:00:00Z"), to: new Date("2026-04-03T00:00:00Z"), tz: "UTC", userIds: [a.id, b.id] });
    expect(r.totals.seconds).toBe(210 * 60);
    expect(r.totals.billableSeconds).toBe(180 * 60);
    expect(r.totals.entries).toBe(3);
    expect(r.byProject.find((x) => x.id === p.id)).toMatchObject({ seconds: 180 * 60, members: 2 });
    expect(r.byMember.map((m) => [m.name, m.seconds])).toEqual([
      ["Alpha", 150 * 60],
      ["Bravo", 60 * 60],
    ]);
    expect(r.entries).toHaveLength(3);
  });

  it("an invalid time zone falls back to UTC instead of erroring", async () => {
    const user = await makeUser();
    await signIn(user);
    const res = await call(report, "GET", "/api/reports", { query: q({ from: "2026-04-01T00:00:00.000Z", to: "2026-04-02T00:00:00.000Z", tz: "Not/AZone" }) });
    expect(res.status).toBe(200);
  });
});

describe("report scoping (test plan 3)", () => {
  const range = { from: "2026-05-01T00:00:00.000Z", to: "2026-05-02T00:00:00.000Z" };

  it.each([
    ["view_own asks for me", false, "me", 200],
    ["view_own asks for all", false, "all", 403],
    ["view_own asks for someone else", false, "other", 403],
    ["view_all asks for all", true, "all", 200],
    ["view_all asks for someone else", true, "other", 200],
  ])("%s → %i", async (_l, viewAll, who, status) => {
    const role = await makeRole(viewAll ? ["reports.view_own", "reports.view_all"] : ["reports.view_own"]);
    const [me, other] = [await makeUser({ role }), await makeUser()];
    await signIn(me);
    const userId = who === "other" ? other.id : who;
    const res = await call<ReportResponse>(report, "GET", "/api/reports", { query: q({ ...range, userId }) });
    expect(res.status).toBe(status);
  });

  it("view_own never sees another member's hours", async () => {
    const [me, other] = [await makeUser(), await makeUser()];
    await makeEntry(other.id, "2026-05-01T09:00:00Z", 60);
    await signIn(me);
    const res = await call<ReportResponse>(report, "GET", "/api/reports", { query: q({ from: "2026-05-01T00:00:00.000Z", to: "2026-05-02T00:00:00.000Z" }) });
    expect(res.body.report.totals.seconds).toBe(0);
  });
});
