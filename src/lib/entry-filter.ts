import { Prisma } from "./prisma";

export type BillableFilter = "all" | "billable" | "non_billable";

/**
 * The one definition of "which entries does this query cover" (R-031). Reports, the
 * timesheet grid, the entry list and the CSV export all build their WHERE from here, as
 * Prisma conditions (`entryWhere`) or raw SQL for aggregates (`entrySql`). The two must
 * stay equivalent; tests/api/entry-filter.test.ts checks them against each other.
 */
export type EntryFilter = {
  from: Date;
  to: Date;
  /** undefined = everyone the caller may see (already scoped by parseReportQuery). */
  userIds?: string[];
  /** A project id, or "none" for entries without a project. */
  projectId?: string;
  billable?: BillableFilter;
  /** Case-insensitive text in the description. */
  q?: string;
  /** Only entries closed automatically after 24 h (D-005). */
  autoStoppedOnly?: boolean;
  /** Leave running timers out (aggregates and exports). Default true. */
  finishedOnly?: boolean;
};

export function entryWhere(f: EntryFilter): Prisma.TimeEntryWhereInput {
  return {
    startTime: { gte: f.from, lte: f.to },
    ...(f.finishedOnly === false ? {} : { endTime: { not: null } }),
    ...(f.userIds ? { userId: { in: f.userIds } } : {}),
    ...(f.projectId ? (f.projectId === "none" ? { projectId: null } : { projectId: f.projectId }) : {}),
    ...(f.billable === "billable" ? { billable: true } : f.billable === "non_billable" ? { billable: false } : {}),
    ...(f.q ? { description: { contains: f.q, mode: "insensitive" as const } } : {}),
    ...(f.autoStoppedOnly ? { autoStopped: true } : {}),
  };
}

/** Same conditions as `entryWhere`, as SQL over `bc_time_entries e`. Every value is a bound parameter. */
export function entrySql(f: EntryFilter): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`e."startTime" >= ${f.from}`, Prisma.sql`e."startTime" <= ${f.to}`];
  if (f.finishedOnly !== false) parts.push(Prisma.sql`e."endTime" IS NOT NULL`);
  if (f.userIds) parts.push(f.userIds.length ? Prisma.sql`e."userId" IN (${Prisma.join(f.userIds)})` : Prisma.sql`FALSE`);
  if (f.projectId) parts.push(f.projectId === "none" ? Prisma.sql`e."projectId" IS NULL` : Prisma.sql`e."projectId" = ${f.projectId}`);
  if (f.billable === "billable") parts.push(Prisma.sql`e."billable" = true`);
  else if (f.billable === "non_billable") parts.push(Prisma.sql`e."billable" = false`);
  if (f.q) parts.push(Prisma.sql`e."description" ILIKE ${`%${escapeLike(f.q)}%`} ESCAPE '\\'`);
  if (f.autoStoppedOnly) parts.push(Prisma.sql`e."autoStopped" = true`);
  return Prisma.join(parts, " AND ");
}

/** Escape LIKE wildcards so a search for "50%" or "a_b" matches those characters literally. */
function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}
