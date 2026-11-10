import { describe, expect, it } from "vitest";
import { GET as getWorkspace, PATCH as setWorkspace } from "@/app/api/workspace/route";
import { GET as report } from "@/app/api/reports/route";
import type { ReportResponse } from "@/app/api/reports/route";
import { prisma } from "@/lib/prisma";
import { call } from "../helpers/http";
import { makeAdmin, makeUser, signIn } from "../helpers/factories";
import { makeEntry } from "../helpers/entries";

const q = (o: Record<string, string>) => "?" + new URLSearchParams(o).toString();

describe("workspace time zone (D-012)", () => {
  it("defaults to Asia/Karachi", async () => {
    await signIn(await makeUser());
    const res = await call<{ timeZone: string }>(getWorkspace, "GET", "/api/workspace");
    expect(res.body.timeZone).toBe("Asia/Karachi");
  });

  it("only the Administrator can change it; invalid zones are refused; changes are audited", async () => {
    await signIn(await makeUser());
    expect((await call(setWorkspace, "PATCH", "/api/workspace", { body: { timeZone: "UTC" } })).status).toBe(403);

    await signIn(await makeAdmin());
    expect((await call(setWorkspace, "PATCH", "/api/workspace", { body: { timeZone: "Mars/Olympus" } })).status).toBe(400);
    const ok = await call<{ timeZone: string; lockDate: string | null }>(setWorkspace, "PATCH", "/api/workspace", { body: { timeZone: "Asia/Dubai" } });
    expect(ok.status).toBe(200);
    expect(ok.body.timeZone).toBe("Asia/Dubai");
    expect(await prisma.auditLog.count({ where: { action: "workspace.time_zone" } })).toBe(1);
    // Setting the zone leaves the lock date alone.
    expect(ok.body.lockDate).toBeNull();
  });

  it("reports group days in the workspace zone, whatever zone the browser sends", async () => {
    const user = await makeUser();
    // 20:00 UTC on 1 March is 01:00 on 2 March in Karachi.
    await makeEntry(user.id, "2026-03-01T20:00:00.000Z", 60);
    await signIn(user);
    const res = await call<ReportResponse>(report, "GET", "/api/reports", { query: q({ from: "2026-02-28T00:00:00.000Z", to: "2026-03-04T00:00:00.000Z", tz: "UTC" }) });
    expect(res.status).toBe(200);
    expect(res.body.report.byDay.filter((d) => d.seconds > 0).map((d) => d.key)).toEqual(["2026-03-02"]);
  });
});
