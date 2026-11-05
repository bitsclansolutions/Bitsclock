import { ApiError, parseQuery } from "./api";
import { hasPermission, type SessionUser } from "./auth";
import { safeZone, type BillableFilter, type ReportFilters } from "./reports";
import { reportQuerySchema } from "./validation";

export type ParsedReportQuery = ReportFilters & { q?: string; kind: "detailed" | "summary"; compare: boolean };

/**
 * Parse report/entry-list filters from the query string (validated by reportQuerySchema)
 * and scope them to what the caller may see: without the "view all" permission the
 * query is forced to the caller's own entries, whatever userId was requested.
 */
export function parseReportQuery(url: URL, user: SessionUser, viewAllPermission: "reports.view_all" | "time.view_all"): ParsedReportQuery {
  const q = parseQuery(url, reportQuerySchema);
  const from = new Date(q.from);
  const to = new Date(q.to);
  if (to < from) throw new ApiError(400, "to must be after from.");
  if (to.getTime() - from.getTime() > 400 * 86400_000) throw new ApiError(400, "Pick a range of at most 400 days.");

  const canViewAll = hasPermission(user, viewAllPermission);
  let userIds: string[] | undefined;
  if (!q.userId || q.userId === "me") userIds = [user.id];
  else if (q.userId === "all") {
    if (!canViewAll) throw new ApiError(403, "You can only view your own time.");
    userIds = undefined;
  } else {
    if (q.userId !== user.id && !canViewAll) throw new ApiError(403, "You can only view your own time.");
    userIds = [q.userId];
  }

  const billable: BillableFilter = q.billable ?? "all";
  return {
    from,
    to,
    tz: safeZone(q.tz),
    userIds,
    projectId: q.projectId,
    billable,
    q: q.q || undefined,
    kind: q.kind ?? "detailed",
    compare: q.compare === "1",
  };
}
