import { ApiError, handler, requirePermission } from "@/lib/api";
import { parseReportQuery } from "@/lib/report-query";
import { buildReport, countEntries, detailedCsvStream, summaryToCsv } from "@/lib/reports";

/**
 * CSV download. ?kind=detailed (one row per entry, default) or ?kind=summary.
 * Detailed exports are complete at any size (D-002, R-003): streamed in keyset chunks,
 * with the expected row count in `X-Total-Rows` so the client can refuse to save a file
 * that came back short. Never cached.
 */
export const GET = handler(async (req) => {
  const me = await requirePermission("reports.export");
  const url = new URL(req.url);
  const f = await parseReportQuery(url, me, "reports.view_all");
  const from = f.from.toISOString().slice(0, 10);
  const to = f.to.toISOString().slice(0, 10);
  const headers = {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="bitsclock-${f.kind}-report_${from}_${to}.csv"`,
    "Cache-Control": "no-store",
  };

  if (f.kind === "summary") {
    const report = await buildReport(f, { withEntries: false });
    return new Response(summaryToCsv(report), { headers });
  }

  const total = f.userIds && f.userIds.length === 0 ? 0 : await countEntries(f);
  if (total === 0) throw new ApiError(404, "No time entries in this range.");
  return new Response(detailedCsvStream(f), { headers: { ...headers, "X-Total-Rows": String(total) } });
});
