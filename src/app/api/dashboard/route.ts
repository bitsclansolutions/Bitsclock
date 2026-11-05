import { prisma } from "@/lib/prisma";
import { handler, jsonCached, parseQuery, requireUser } from "@/lib/api";
import { hasPermission, type SessionUser } from "@/lib/auth";
import { closeOverdueTimers, entryInclude, getActiveEntry, serializeEntry, type EntryDTO } from "@/lib/entries";
import { buildReport, safeZone, type ReportData } from "@/lib/reports";
import { cached, entryTags, paramsKey } from "@/lib/server-cache";
import { dashboardQuerySchema } from "@/lib/validation";

export type DashboardDTO = {
  me: {
    todaySeconds: number;
    weekSeconds: number;
    monthSeconds: number;
    weekBillableSeconds: number;
    week: ReportData["byDay"];
    byProject: ReportData["byProject"];
    recent: EntryDTO[];
    active: EntryDTO | null;
  };
  team: null | {
    todaySeconds: number;
    weekSeconds: number;
    weekBillableSeconds: number;
    activeTimers: EntryDTO[];
    byMember: ReportData["byMember"];
    byProject: ReportData["byProject"];
    week: ReportData["byDay"];
    memberCount: number;
    activeProjects: number;
  };
};

/**
 * Dashboard data. The client sends the instants that bound its local
 * "today", "this week" and "this month" so buckets follow the viewer's zone.
 */
export const GET = handler(async (req) => {
  const me = await requireUser();
  const url = new URL(req.url);
  const q = parseQuery(url, dashboardQuerySchema);
  // Role edits change what the team section shows, so they invalidate it too (R-066).
  // Per-user tag unless the team section is shown (R-030): another member's edit only clears team views.
  const entryTag = hasPermission(me, "dashboard.team") ? entryTags(undefined) : entryTags([me.id]);
  const data = await cached(`dashboard:${me.id}:${paramsKey(url.searchParams)}`, { ttlMs: 20_000, tags: [...entryTag, "projects", "users", "roles"] }, () => loadDashboard(me, q));
  return jsonCached(req, data, { maxAge: 10 });
});

const MAX_RANGE_MS = 400 * 86400_000;

async function loadDashboard(me: SessionUser, q: { tz?: string; dayStart?: string; weekStart?: string; monthStart?: string }): Promise<DashboardDTO> {
  const tz = safeZone(q.tz);
  const now = new Date();
  // Client-chosen bounds, clamped so a crafted request can't make the dashboard scan years (R-066).
  const bound = (iso: string | undefined, fallbackMs: number) => {
    const d = iso ? new Date(iso) : new Date(now.getTime() - fallbackMs);
    return new Date(Math.max(d.getTime(), now.getTime() - MAX_RANGE_MS));
  };
  const dayStart = bound(q.dayStart, 86400_000);
  const weekStart = bound(q.weekStart, 7 * 86400_000);
  const monthStart = bound(q.monthStart, 30 * 86400_000);
  const end = new Date(now.getTime() + 86400_000);

  const [mine, month, today, active, recent] = await Promise.all([
    buildReport({ from: weekStart, to: end, tz, userIds: [me.id] }, { withEntries: false }),
    prisma.timeEntry.aggregate({ where: { userId: me.id, endTime: { not: null }, startTime: { gte: monthStart, lt: end } }, _sum: { durationSeconds: true } }),
    prisma.timeEntry.aggregate({ where: { userId: me.id, endTime: { not: null }, startTime: { gte: dayStart, lt: end } }, _sum: { durationSeconds: true } }),
    getActiveEntry(me.id),
    prisma.timeEntry.findMany({ where: { userId: me.id, endTime: { not: null }, startTime: { gte: monthStart } }, include: entryInclude, orderBy: { startTime: "desc" }, take: 6 }),
  ]);
  const todaySeconds = today._sum.durationSeconds ?? 0;

  const data: DashboardDTO = {
    me: {
      todaySeconds,
      weekSeconds: mine.totals.seconds,
      monthSeconds: month._sum.durationSeconds ?? 0,
      weekBillableSeconds: mine.totals.billableSeconds,
      week: mine.byDay,
      byProject: mine.byProject,
      recent: recent.map(serializeEntry),
      active,
    },
    team: null,
  };

  if (hasPermission(me, "dashboard.team")) {
    const [team, teamToday, timers, memberCount, activeProjects] = await Promise.all([
      buildReport({ from: weekStart, to: end, tz }, { withEntries: false }),
      prisma.timeEntry.aggregate({ where: { endTime: { not: null }, startTime: { gte: dayStart, lt: end } }, _sum: { durationSeconds: true } }),
      // Served by the partial "one running timer per user" index (D-006, R-030).
      prisma.timeEntry.findMany({ where: { endTime: null }, include: entryInclude, orderBy: { startTime: "asc" } }),
      prisma.user.count({ where: { isActive: true } }),
      prisma.project.count({ where: { isArchived: false } }),
    ]);
    data.team = {
      todaySeconds: teamToday._sum.durationSeconds ?? 0,
      weekSeconds: team.totals.seconds,
      weekBillableSeconds: team.totals.billableSeconds,
      // Timers left running past 24 h are closed on read (D-005) instead of shown as running.
      activeTimers: await closeOverdueTimers(timers.map(serializeEntry)),
      byMember: team.byMember,
      byProject: team.byProject,
      week: team.byDay,
      memberCount,
      activeProjects,
    };
  }
  return data;
}
