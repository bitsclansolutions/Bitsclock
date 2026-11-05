import { handler, jsonCached, requireAnyPermission } from "@/lib/api";
import { parseReportQuery } from "@/lib/report-query";
import { buildReport, type ReportData } from "@/lib/reports";
import { cached, entryTags, paramsKey } from "@/lib/server-cache";

export type ReportResponse = {
  report: ReportData;
  /** Same filters over the preceding period of equal length; only when ?compare=1. */
  previous: Pick<ReportData, "totals" | "byDay" | "byProject" | "byMember"> | null;
};

/** Scoped by parseReportQuery: members without reports.view_all only ever get their own entries. */
export const GET = handler(async (req) => {
  const me = await requireAnyPermission("reports.view_own", "reports.view_all");
  const url = new URL(req.url);
  const f = parseReportQuery(url, me, "reports.view_all");
  const data = await cached<ReportResponse>(`report:${me.id}:${paramsKey(url.searchParams)}`, { ttlMs: 30_000, tags: [...entryTags(f.userIds), "projects", "users", "roles"] }, async () => {
    const report = await buildReport(f, { withEntries: f.kind === "detailed" });
    if (!f.compare) return { report, previous: null };
    const span = f.to.getTime() - f.from.getTime();
    const prev = await buildReport({ ...f, from: new Date(f.from.getTime() - span - 1), to: new Date(f.from.getTime() - 1) });
    return { report, previous: { totals: prev.totals, byDay: prev.byDay, byProject: prev.byProject, byMember: prev.byMember } };
  });
  return jsonCached(req, data, { maxAge: 20 });
});
