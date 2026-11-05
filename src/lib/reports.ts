import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { entryInclude, serializeEntry, type EntryDTO } from "./entries";

export type BillableFilter = "all" | "billable" | "non_billable";

export type ReportFilters = {
  from: Date;
  to: Date;
  tz: string;
  userIds?: string[]; // undefined = everyone
  projectId?: string; // "none" = entries without a project
  billable?: BillableFilter;
};

export type ReportData = {
  totals: {
    seconds: number;
    billableSeconds: number;
    nonBillableSeconds: number;
    entries: number;
    activeDays: number;
    avgPerActiveDay: number;
    members: number;
    projects: number;
    busiestDay: { key: string; seconds: number } | null;
  };
  byDay: { key: string; seconds: number; billableSeconds: number; nonBillableSeconds: number; entries: number }[];
  byProject: { id: string | null; name: string; color: string; seconds: number; billableSeconds: number; entries: number; members: number; share: number }[];
  byMember: { id: string; name: string; seconds: number; billableSeconds: number; entries: number; projects: number; share: number }[];
  entries: EntryDTO[];
};

/** Local calendar day (YYYY-MM-DD) of an instant in an IANA time zone. */
export function dayKeyInZone(d: Date, tz: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export function safeZone(tz: string | null | undefined) {
  if (!tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

/** SQL WHERE fragment shared by every aggregate of a report. */
function whereSql(f: ReportFilters) {
  return Prisma.sql`e."endTime" IS NOT NULL AND e."startTime" >= ${f.from} AND e."startTime" <= ${f.to}
    ${f.userIds ? Prisma.sql`AND e."userId" IN (${Prisma.join(f.userIds)})` : Prisma.empty}
    ${f.projectId ? (f.projectId === "none" ? Prisma.sql`AND e."projectId" IS NULL` : Prisma.sql`AND e."projectId" = ${f.projectId}`) : Prisma.empty}
    ${f.billable === "billable" ? Prisma.sql`AND e."billable" = true` : f.billable === "non_billable" ? Prisma.sql`AND e."billable" = false` : Prisma.empty}`;
}

/** Local calendar day of "startTime" in the report's zone (timestamps are stored as UTC). */
function localDaySql(tz: string) {
  return Prisma.sql`to_char((e."startTime" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM-DD')`;
}

const ENTRY_LIMIT = 2000;

/**
 * Report aggregates are computed in PostgreSQL (three GROUP BY queries, run in
 * parallel, each served by the time-entry indexes) rather than by pulling rows into
 * Node. Only the "detailed" entry list fetches rows, capped at ENTRY_LIMIT.
 */
export async function buildReport(f: ReportFilters, opts: { withEntries?: boolean } = {}): Promise<ReportData> {
  const withEntries = opts.withEntries ?? true;
  const empty: ReportData = {
    totals: { seconds: 0, billableSeconds: 0, nonBillableSeconds: 0, entries: 0, activeDays: 0, avgPerActiveDay: 0, members: 0, projects: 0, busiestDay: null },
    byDay: [],
    byProject: [],
    byMember: [],
    entries: [],
  };
  if (f.userIds && f.userIds.length === 0) return empty;

  const where = whereSql(f);
  const day = localDaySql(f.tz);

  type DayRow = { key: string; seconds: number; billable: number; entries: number };
  type ProjectRow = { id: string | null; name: string | null; color: string | null; seconds: number; billable: number; entries: number; members: number };
  type MemberRow = { id: string; name: string; seconds: number; billable: number; entries: number; projects: number };

  const [days, projects, members, rows] = await Promise.all([
    prisma.$queryRaw<DayRow[]>(Prisma.sql`
      SELECT ${day} AS key,
             COALESCE(SUM(e."durationSeconds"), 0)::int AS seconds,
             COALESCE(SUM(CASE WHEN e."billable" THEN e."durationSeconds" ELSE 0 END), 0)::int AS billable,
             COUNT(*)::int AS entries
      FROM bc_time_entries e
      WHERE ${where}
      GROUP BY 1 ORDER BY 1`),
    prisma.$queryRaw<ProjectRow[]>(Prisma.sql`
      SELECT e."projectId" AS id, p."name", p."color",
             COALESCE(SUM(e."durationSeconds"), 0)::int AS seconds,
             COALESCE(SUM(CASE WHEN e."billable" THEN e."durationSeconds" ELSE 0 END), 0)::int AS billable,
             COUNT(*)::int AS entries,
             COUNT(DISTINCT e."userId")::int AS members
      FROM bc_time_entries e LEFT JOIN bc_projects p ON p."id" = e."projectId"
      WHERE ${where}
      GROUP BY e."projectId", p."name", p."color" ORDER BY seconds DESC`),
    prisma.$queryRaw<MemberRow[]>(Prisma.sql`
      SELECT e."userId" AS id, u."name",
             COALESCE(SUM(e."durationSeconds"), 0)::int AS seconds,
             COALESCE(SUM(CASE WHEN e."billable" THEN e."durationSeconds" ELSE 0 END), 0)::int AS billable,
             COUNT(*)::int AS entries,
             COUNT(DISTINCT COALESCE(e."projectId", '')) ::int AS projects
      FROM bc_time_entries e JOIN bc_users u ON u."id" = e."userId"
      WHERE ${where}
      GROUP BY e."userId", u."name" ORDER BY seconds DESC`),
    withEntries
      ? prisma.timeEntry.findMany({
          where: {
            endTime: { not: null },
            startTime: { gte: f.from, lte: f.to },
            ...(f.userIds ? { userId: { in: f.userIds } } : {}),
            ...(f.projectId ? (f.projectId === "none" ? { projectId: null } : { projectId: f.projectId }) : {}),
            ...(f.billable === "billable" ? { billable: true } : f.billable === "non_billable" ? { billable: false } : {}),
          },
          include: entryInclude,
          orderBy: { startTime: "desc" },
          take: ENTRY_LIMIT,
        })
      : Promise.resolve([]),
  ]);

  const seconds = days.reduce((s, d) => s + d.seconds, 0);
  const billableSeconds = days.reduce((s, d) => s + d.billable, 0);
  const entries = days.reduce((s, d) => s + d.entries, 0);
  const busiest = days.reduce<ReportData["totals"]["busiestDay"]>((best, d) => (!best || d.seconds > best.seconds ? { key: d.key, seconds: d.seconds } : best), null);
  const share = (s: number) => (seconds ? Math.round((s / seconds) * 1000) / 10 : 0);

  return {
    totals: {
      seconds,
      billableSeconds,
      nonBillableSeconds: seconds - billableSeconds,
      entries,
      activeDays: days.length,
      avgPerActiveDay: days.length ? Math.round(seconds / days.length) : 0,
      members: members.length,
      projects: projects.length,
      busiestDay: busiest,
    },
    byDay: days.map((d) => ({ key: d.key, seconds: d.seconds, billableSeconds: d.billable, nonBillableSeconds: d.seconds - d.billable, entries: d.entries })),
    byProject: projects.map((p) => ({ id: p.id, name: p.name ?? "No project", color: p.color ?? "#94a3b8", seconds: p.seconds, billableSeconds: p.billable, entries: p.entries, members: p.members, share: share(p.seconds) })),
    byMember: members.map((m) => ({ id: m.id, name: m.name, seconds: m.seconds, billableSeconds: m.billable, entries: m.entries, projects: m.projects, share: share(m.seconds) })),
    entries: rows.map(serializeEntry),
  };
}

function csvCell(v: string | number | boolean | null | undefined) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function entriesToCsv(entries: EntryDTO[], tz: string) {
  const fmt = (iso: string) => {
    try {
      return new Date(iso).toLocaleString("en-GB", { timeZone: tz, hour12: false });
    } catch {
      return iso;
    }
  };
  const header = ["Date", "Member", "Project", "Description", "Start", "End", "Duration (h)", "Duration (hh:mm)", "Billable"];
  const lines = [header.map(csvCell).join(",")];
  for (const e of entries) {
    const secs = e.durationSeconds;
    const hhmm = `${Math.floor(secs / 3600)}:${String(Math.floor((secs % 3600) / 60)).padStart(2, "0")}`;
    lines.push(
      [
        dayKeyInZone(new Date(e.startTime), tz),
        e.user.name,
        e.project?.name ?? "No project",
        e.description,
        fmt(e.startTime),
        e.endTime ? fmt(e.endTime) : "",
        (secs / 3600).toFixed(2),
        hhmm,
        e.billable ? "Yes" : "No",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\r\n");
}

export function summaryToCsv(report: ReportData) {
  const lines: string[] = [];
  lines.push(["Project", "Hours", "Billable hours", "Entries", "Members", "Share %"].join(","));
  for (const p of report.byProject) {
    lines.push([p.name, (p.seconds / 3600).toFixed(2), (p.billableSeconds / 3600).toFixed(2), p.entries, p.members, p.share].map(csvCell).join(","));
  }
  lines.push("");
  lines.push(["Member", "Hours", "Billable hours", "Entries", "Projects", "Share %"].join(","));
  for (const m of report.byMember) {
    lines.push([m.name, (m.seconds / 3600).toFixed(2), (m.billableSeconds / 3600).toFixed(2), m.entries, m.projects, m.share].map(csvCell).join(","));
  }
  lines.push("");
  lines.push(["Day", "Hours", "Billable hours", "Non-billable hours", "Entries"].join(","));
  for (const d of report.byDay) {
    lines.push([d.key, (d.seconds / 3600).toFixed(2), (d.billableSeconds / 3600).toFixed(2), (d.nonBillableSeconds / 3600).toFixed(2), d.entries].map(csvCell).join(","));
  }
  return lines.join("\r\n");
}
