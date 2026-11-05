import { Prisma, prisma } from "./prisma";
import { entryInclude, serializeEntry, type EntryDTO } from "./entries";
import { entrySql, entryWhere, type BillableFilter, type EntryFilter } from "./entry-filter";

export type { BillableFilter };

export type ReportFilters = EntryFilter & { tz: string };

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
  /** Newest first, at most ENTRY_LIMIT rows (see `truncated`). Export CSV for the full list. */
  entries: EntryDTO[];
  /** True when `entries` holds fewer rows than `totals.entries` (D-002). */
  truncated: boolean;
};

/** Formatter for the local calendar day (YYYY-MM-DD) in an IANA zone. Build once, use for many rows. */
export function dayKeyFormatter(tz: string) {
  let fmt: Intl.DateTimeFormat | null = null;
  try {
    fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  } catch {
    fmt = null;
  }
  return (d: Date) => {
    if (!fmt) return d.toISOString().slice(0, 10);
    const parts = fmt.formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  };
}

/** Local calendar day (YYYY-MM-DD) of an instant in an IANA time zone. */
export function dayKeyInZone(d: Date, tz: string) {
  return dayKeyFormatter(tz)(d);
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

/** Local calendar day of "startTime" in the report's zone (timestamps are stored as UTC). */
function localDaySql(tz: string) {
  return Prisma.sql`to_char((e."startTime" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM-DD')`;
}

/** Rows shown on screen and in the PDF; the CSV export has no cap (D-002). */
export const ENTRY_LIMIT = 2000;

/**
 * Report aggregates are computed in PostgreSQL (three GROUP BY queries, run in
 * parallel, each served by the time-entry indexes) rather than by pulling rows into
 * Node. Sums are float8, so totals can't overflow at any team size (R-029). Only the
 * "detailed" entry list fetches rows, capped at ENTRY_LIMIT and flagged when cut.
 */
export async function buildReport(f: ReportFilters, opts: { withEntries?: boolean } = {}): Promise<ReportData> {
  const withEntries = opts.withEntries ?? true;
  const empty: ReportData = {
    totals: { seconds: 0, billableSeconds: 0, nonBillableSeconds: 0, entries: 0, activeDays: 0, avgPerActiveDay: 0, members: 0, projects: 0, busiestDay: null },
    byDay: [],
    byProject: [],
    byMember: [],
    entries: [],
    truncated: false,
  };
  if (f.userIds && f.userIds.length === 0) return empty;

  const filter = { ...f, finishedOnly: true };
  const where = entrySql(filter);
  const day = localDaySql(f.tz);

  type DayRow = { key: string; seconds: number; billable: number; entries: number };
  type ProjectRow = { id: string | null; name: string | null; color: string | null; seconds: number; billable: number; entries: number; members: number };
  type MemberRow = { id: string; name: string; seconds: number; billable: number; entries: number; projects: number };

  const [days, projects, members, rows] = await Promise.all([
    prisma.$queryRaw<DayRow[]>(Prisma.sql`
      SELECT ${day} AS key,
             COALESCE(SUM(e."durationSeconds"), 0)::float8 AS seconds,
             COALESCE(SUM(CASE WHEN e."billable" THEN e."durationSeconds" ELSE 0 END), 0)::float8 AS billable,
             COUNT(*)::int AS entries
      FROM bc_time_entries e
      WHERE ${where}
      GROUP BY 1 ORDER BY 1`),
    prisma.$queryRaw<ProjectRow[]>(Prisma.sql`
      SELECT e."projectId" AS id, p."name", p."color",
             COALESCE(SUM(e."durationSeconds"), 0)::float8 AS seconds,
             COALESCE(SUM(CASE WHEN e."billable" THEN e."durationSeconds" ELSE 0 END), 0)::float8 AS billable,
             COUNT(*)::int AS entries,
             COUNT(DISTINCT e."userId")::int AS members
      FROM bc_time_entries e LEFT JOIN bc_projects p ON p."id" = e."projectId"
      WHERE ${where}
      GROUP BY e."projectId", p."name", p."color" ORDER BY seconds DESC`),
    prisma.$queryRaw<MemberRow[]>(Prisma.sql`
      SELECT e."userId" AS id,
             CASE WHEN u."deletedAt" IS NULL THEN u."name" ELSE u."name" || ' (deleted)' END AS "name",
             COALESCE(SUM(e."durationSeconds"), 0)::float8 AS seconds,
             COALESCE(SUM(CASE WHEN e."billable" THEN e."durationSeconds" ELSE 0 END), 0)::float8 AS billable,
             COUNT(*)::int AS entries,
             COUNT(DISTINCT COALESCE(e."projectId", '')) ::int AS projects
      FROM bc_time_entries e JOIN bc_users u ON u."id" = e."userId"
      WHERE ${where}
      GROUP BY e."userId", u."name", u."deletedAt" ORDER BY seconds DESC`),
    withEntries
      ? prisma.timeEntry.findMany({ where: entryWhere(filter), include: entryInclude, orderBy: [{ startTime: "desc" }, { id: "desc" }], take: ENTRY_LIMIT })
      : Promise.resolve([]),
  ]);

  const num = (v: number | bigint | string) => Number(v);
  const seconds = days.reduce((s, d) => s + num(d.seconds), 0);
  const billableSeconds = days.reduce((s, d) => s + num(d.billable), 0);
  const entries = days.reduce((s, d) => s + num(d.entries), 0);
  const busiest = days.reduce<ReportData["totals"]["busiestDay"]>((best, d) => (!best || num(d.seconds) > best.seconds ? { key: d.key, seconds: num(d.seconds) } : best), null);
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
    byDay: days.map((d) => ({ key: d.key, seconds: num(d.seconds), billableSeconds: num(d.billable), nonBillableSeconds: num(d.seconds) - num(d.billable), entries: num(d.entries) })),
    byProject: projects.map((p) => ({ id: p.id, name: p.name ?? "No project", color: p.color ?? "#94a3b8", seconds: num(p.seconds), billableSeconds: num(p.billable), entries: num(p.entries), members: num(p.members), share: share(num(p.seconds)) })),
    byMember: members.map((m) => ({ id: m.id, name: m.name, seconds: num(m.seconds), billableSeconds: num(m.billable), entries: num(m.entries), projects: num(m.projects), share: share(num(m.seconds)) })),
    entries: rows.map(serializeEntry),
    truncated: withEntries && rows.length < entries,
  };
}

/**
 * One CSV cell. Text that a spreadsheet would treat as a formula (starting with = + - @,
 * tab or carriage return) gets a leading apostrophe so Excel and Sheets show it as text
 * instead of running it (R-020, CSV injection). Numbers are written as numbers.
 */
export function csvCell(v: string | number | boolean | null | undefined) {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const DETAILED_CSV_HEADER = ["Date", "Member", "Project", "Description", "Start", "End", "Duration (h)", "Duration (hh:mm)", "Billable", "Auto-stopped"];

/** Turns entries into CSV lines; formatters are built once per export, not per row (R-055). */
export function csvRowWriter(tz: string) {
  const dayKey = dayKeyFormatter(tz);
  let timeFmt: Intl.DateTimeFormat | null = null;
  try {
    timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    timeFmt = null;
  }
  const fmt = (iso: string) => (timeFmt ? timeFmt.format(new Date(iso)) : iso);
  return (e: EntryDTO) => {
    const secs = e.durationSeconds;
    const hhmm = `${Math.floor(secs / 3600)}:${String(Math.floor((secs % 3600) / 60)).padStart(2, "0")}`;
    return [
      dayKey(new Date(e.startTime)),
      e.user.name,
      e.project?.name ?? "No project",
      e.description,
      fmt(e.startTime),
      e.endTime ? fmt(e.endTime) : "",
      (secs / 3600).toFixed(2),
      hhmm,
      e.billable ? "Yes" : "No",
      e.autoStopped ? "Yes" : "No",
    ]
      .map(csvCell)
      .join(",");
  };
}

export function entriesToCsv(entries: EntryDTO[], tz: string) {
  const row = csvRowWriter(tz);
  return [DETAILED_CSV_HEADER.map(csvCell).join(","), ...entries.map(row)].join("\r\n");
}

export const EXPORT_CHUNK = 1000;

/**
 * The detailed CSV as a stream (D-002, R-003): every matching entry, read in keyset chunks
 * of EXPORT_CHUNK (startTime desc, id desc), each a short separate query, written straight
 * to the response so memory stays flat at any size. Starts with a UTF-8 BOM for Excel.
 */
export function detailedCsvStream(f: ReportFilters): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const row = csvRowWriter(f.tz);
  const base = entryWhere({ ...f, finishedOnly: true });
  let after: { startTime: Date; id: string } | null = null;
  let done = false;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(enc.encode("﻿" + DETAILED_CSV_HEADER.map(csvCell).join(",")));
    },
    async pull(controller) {
      if (done) return;
      const rows = await prisma.timeEntry.findMany({
        where: after ? { AND: [base, { OR: [{ startTime: { lt: after.startTime } }, { startTime: after.startTime, id: { lt: after.id } }] }] } : base,
        include: entryInclude,
        orderBy: [{ startTime: "desc" }, { id: "desc" }],
        take: EXPORT_CHUNK,
      });
      if (rows.length) {
        controller.enqueue(enc.encode("\r\n" + rows.map((r) => row(serializeEntry(r))).join("\r\n")));
        const last = rows[rows.length - 1]!;
        after = { startTime: last.startTime, id: last.id };
      }
      if (rows.length < EXPORT_CHUNK) {
        done = true;
        controller.close();
      }
    },
  });
}

/** How many entries the detailed export will contain (sent as a header so the client can verify the file). */
export function countEntries(f: ReportFilters) {
  return prisma.timeEntry.count({ where: entryWhere({ ...f, finishedOnly: true }) });
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
  return "﻿" + lines.join("\r\n");
}
