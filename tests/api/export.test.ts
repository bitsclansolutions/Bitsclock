import { describe, expect, it } from "vitest";
import { GET as exportCsv } from "@/app/api/reports/export/route";
import { GET as report } from "@/app/api/reports/route";
import { prisma } from "@/lib/prisma";
import type { ReportResponse } from "@/app/api/reports/route";
import { ORIGIN } from "../helpers/http";
import { call } from "../helpers/http";
import { makeUser, signIn } from "../helpers/factories";

const RANGE = { from: "2026-01-01T00:00:00.000Z", to: "2026-03-01T00:00:00.000Z" };

/** 2,001 one-minute entries for one member, inserted in one statement. */
async function seed2001(userId: string) {
  const base = Date.parse("2026-01-05T08:00:00.000Z");
  await prisma.timeEntry.createMany({
    data: Array.from({ length: 2001 }, (_, i) => ({
      userId,
      startTime: new Date(base + i * 120_000),
      endTime: new Date(base + i * 120_000 + 60_000),
      durationSeconds: 60,
      billable: i % 2 === 0,
      description: i === 7 ? "=HYPERLINK(\"x\")" : `Task ${i}`,
    })),
  });
}

describe("CSV export completeness (D-002, R-003, test plan 5)", () => {
  it("streams all 2,001 rows, says so in X-Total-Rows, and the screen list is flagged as truncated", async () => {
    const user = await makeUser();
    await seed2001(user.id);
    await signIn(user);
    const res = await exportCsv(new Request(`${ORIGIN}/api/reports/export?${new URLSearchParams({ ...RANGE, kind: "detailed", tz: "UTC" })}`, { headers: { host: "localhost:3100" } }), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Total-Rows")).toBe("2001");
    const text = await res.text();
    const lines = text.replace(/^﻿/, "").split("\r\n");
    expect(lines).toHaveLength(2002); // header + 2,001
    expect(new Set(lines.slice(1)).size).toBe(2001);
    // Formula cells are neutralised in the stream too (R-020).
    expect(text).toContain(`"'=HYPERLINK(""x"")"`);

    const screen = await call<ReportResponse>(report, "GET", "/api/reports", { query: "?" + new URLSearchParams({ ...RANGE, kind: "detailed" }) });
    expect(screen.body.report.totals.entries).toBe(2001);
    expect(screen.body.report.entries).toHaveLength(2000);
    expect(screen.body.report.truncated).toBe(true);
  });

  it("a range with nothing in it answers 404 instead of an empty file", async () => {
    await signIn(await makeUser());
    const res = await call(exportCsv, "GET", "/api/reports/export", { query: "?" + new URLSearchParams(RANGE) });
    expect(res.status).toBe(404);
  });
});
