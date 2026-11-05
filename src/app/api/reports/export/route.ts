import { ApiError, handler, requirePermission } from "@/lib/api";
import { parseReportQuery } from "@/lib/report-query";
import { buildReport, entriesToCsv, summaryToCsv } from "@/lib/reports";

/** CSV download. ?kind=detailed (one row per entry, default) or ?kind=summary (by project / member / day). */
export const GET = handler(async (req) => {
  const me = await requirePermission("reports.export");
  const url = new URL(req.url);
  const f = parseReportQuery(url, me, "reports.view_all");
  const kind = f.kind;
  const report = await buildReport(f);
  if (kind === "detailed" && report.entries.length === 0 && report.totals.entries === 0) {
    throw new ApiError(404, "No time entries in this range.");
  }
  const csv = kind === "summary" ? summaryToCsv(report) : entriesToCsv(report.entries, f.tz);
  const from = f.from.toISOString().slice(0, 10);
  const to = f.to.toISOString().slice(0, 10);
  return new Response("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="bitsclock-${kind}-report_${from}_${to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
});
