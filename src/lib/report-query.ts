import { ApiError, parseQuery } from "./api";
import { hasPermission, type SessionUser } from "./auth";
import { safeZone } from "./reports";
import type { BillableFilter, EntryFilter } from "./entry-filter";
import { reportQuerySchema } from "./validation";

export type ParsedReportQuery = EntryFilter & {
  tz: string;
  kind: "detailed" | "summary";
  compare: boolean;
  limit?: number;
  cursor?: string;
  page?: number;
};

/**
 * Parse report/entry-list filters from the query string (validated by reportQuerySchema)
 * and scope them to what the caller may see: without the "view all" permission the
 * query is forced to the caller's own entries, whatever userId was requested.
 *
 * `maxDays` caps the range (reports aggregate the whole range in one go). The paginated
 * entry list passes `null`: it never reads more than one page, so "All time" is safe there.
 */
export function parseReportQuery(
  url: URL,
  user: SessionUser,
  viewAllPermission: "reports.view_all" | "time.view_all",
  opts: { maxDays?: number | null } = {},
): ParsedReportQuery {
  const q = parseQuery(url, reportQuerySchema);
  const from = new Date(q.from);
  const to = new Date(q.to);
  const maxDays = opts.maxDays === undefined ? 400 : opts.maxDays;
  if (to < from) throw new ApiError(400, "to must be after from.");
  if (maxDays !== null && to.getTime() - from.getTime() > maxDays * 86400_000) throw new ApiError(400, `Pick a range of at most ${maxDays} days.`);

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
    autoStoppedOnly: q.autoStopped === "1",
    kind: q.kind ?? "detailed",
    compare: q.compare === "1",
    // Reports always count finished entries; the entry list includes a running timer unless asked not to.
    ...(q.finished === "1" ? { finishedOnly: true } : {}),
    limit: q.limit,
    cursor: q.cursor,
    page: q.page,
  };
}
