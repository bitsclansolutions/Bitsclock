import { Prisma, prisma } from "@/lib/prisma";
import { handler, jsonCached, requireAnyPermission } from "@/lib/api";
import { parseReportQuery } from "@/lib/report-query";
import { entrySql } from "@/lib/entry-filter";
import { cached, entryTags, paramsKey } from "@/lib/server-cache";

export type TimesheetCell = {
  /** Project id, or null for entries without a project. */
  projectId: string | null;
  /** Local calendar day (YYYY-MM-DD) in the requested time zone. */
  key: string;
  seconds: number;
  billableSeconds: number;
  count: number;
};

export type TimesheetProject = { id: string; name: string; color: string; billable: boolean; isArchived: boolean };

export type TimesheetResponse = { cells: TimesheetCell[]; projects: TimesheetProject[] };

/**
 * Hours per project per local day for the timesheet grid, aggregated in PostgreSQL
 * (one GROUP BY on the indexed time range) so a whole year is a few hundred rows.
 * Running timers are left out. Uses the shared entry filter (R-031), so project,
 * billable and search filters mean the same here as in reports. Scoped by
 * parseReportQuery: without time.view_all the caller only ever gets their own time.
 */
export const GET = handler(async (req) => {
  const me = await requireAnyPermission("time.track", "time.view_all");
  const url = new URL(req.url);
  const f = await parseReportQuery(url, me, "time.view_all");
  const data = await cached<TimesheetResponse>(`timesheet:${me.id}:${paramsKey(url.searchParams)}`, { ttlMs: 15_000, tags: [...entryTags(f.userIds), "projects", "roles", "settings"] }, async () => {
    if (f.userIds && f.userIds.length === 0) return { cells: [], projects: [] };
    const rows = await prisma.$queryRaw<{ projectId: string | null; key: string; seconds: number; billableSeconds: number; count: number }[]>(Prisma.sql`
      SELECT e."projectId",
             to_char((e."startTime" AT TIME ZONE 'UTC') AT TIME ZONE ${f.tz}, 'YYYY-MM-DD') AS key,
             COALESCE(SUM(e."durationSeconds"), 0)::float8 AS seconds,
             COALESCE(SUM(CASE WHEN e."billable" THEN e."durationSeconds" ELSE 0 END), 0)::float8 AS "billableSeconds",
             COUNT(*)::int AS count
      FROM bc_time_entries e
      WHERE ${entrySql({ ...f, finishedOnly: true })}
      GROUP BY 1, 2`);
    const cells = rows.map((r) => ({ ...r, seconds: Number(r.seconds), billableSeconds: Number(r.billableSeconds), count: Number(r.count) }));
    const ids = [...new Set(cells.map((c) => c.projectId).filter((id): id is string => !!id))];
    const projects = ids.length ? await prisma.project.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, color: true, billable: true, isArchived: true } }) : [];
    return { cells, projects };
  });
  return jsonCached(req, data, { maxAge: 10 });
});
