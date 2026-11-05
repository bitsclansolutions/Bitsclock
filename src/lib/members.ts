import { prisma } from "./prisma";

export type MemberDTO = {
  id: string;
  name: string;
  email: string;
  jobTitle: string;
  isActive: boolean;
  createdAt: string;
  role: { id: string; name: string; color: string };
  running: boolean;
  weekSeconds: number;
  /** All-time logged seconds (full listing only). */
  totalSeconds: number;
  /** Distinct projects they have logged time on (full listing only). */
  projectCount: number;
  /** Start of their most recent entry, or null (full listing only). */
  lastActiveAt: string | null;
  /** Their last invitation / password email couldn't be sent (full listing only, R-049). */
  inviteEmailFailed: boolean;
  /** Set for deleted members (D-011, Administrator's "Deleted" filter only). */
  deletedAt: string | null;
};

/**
 * Member list.
 * - full (users.view): every member with email, status, running timer and totals.
 * - otherwise (pickers): active members with id, name and role only.
 * - deleted (Administrator, D-011): only deleted members, with the same full details, so the
 *   Team page can show them with the same card and row. Their email on record is shown.
 */
export async function loadMembers(weekStart: Date, full: boolean, opts: { deleted?: boolean } = {}): Promise<MemberDTO[]> {
  const users = await prisma.user.findMany({
    // Deleted members never appear in the normal list or any picker.
    where: opts.deleted ? { deletedAt: { not: null } } : full ? { deletedAt: null } : { isActive: true, deletedAt: null },
    include: { role: { select: { id: true, name: true, color: true } } },
    orderBy: opts.deleted ? [{ deletedAt: "desc" }] : [{ isActive: "desc" }, { name: "asc" }],
  });
  if (!full && !opts.deleted) {
    return users.map((u) => ({ id: u.id, name: u.name, email: "", jobTitle: "", isActive: true, createdAt: "", role: u.role, running: false, weekSeconds: 0, totalSeconds: 0, projectCount: 0, lastActiveAt: null, inviteEmailFailed: false, deletedAt: null }));
  }
  const [running, week, totals, perProject] = await Promise.all([
    prisma.timeEntry.findMany({ where: { endTime: null }, select: { userId: true } }),
    Number.isNaN(weekStart.getTime())
      ? Promise.resolve([] as { userId: string; _sum: { durationSeconds: number | null } }[])
      : prisma.timeEntry.groupBy({ by: ["userId"], where: { endTime: { not: null }, startTime: { gte: weekStart } }, _sum: { durationSeconds: true } }),
    prisma.timeEntry.groupBy({ by: ["userId"], where: { endTime: { not: null } }, _sum: { durationSeconds: true }, _max: { startTime: true } }),
    prisma.timeEntry.groupBy({ by: ["userId", "projectId"], where: { projectId: { not: null } } }),
  ]);
  const runningSet = new Set(running.map((r) => r.userId));
  const weekMap = new Map(week.map((w) => [w.userId, w._sum.durationSeconds ?? 0]));
  const totalMap = new Map(totals.map((t) => [t.userId, { seconds: t._sum.durationSeconds ?? 0, last: t._max.startTime }]));
  const projectCounts = new Map<string, number>();
  for (const p of perProject) projectCounts.set(p.userId, (projectCounts.get(p.userId) ?? 0) + 1);

  return users.map((u) => ({
    id: u.id,
    name: u.name,
    // A deleted member's real address is kept on record in deletedEmail.
    email: u.deletedAt ? (u.deletedEmail ?? "") : u.email,
    jobTitle: u.jobTitle ?? "",
    isActive: u.isActive,
    createdAt: u.createdAt.toISOString(),
    role: u.role,
    running: runningSet.has(u.id),
    weekSeconds: weekMap.get(u.id) ?? 0,
    totalSeconds: totalMap.get(u.id)?.seconds ?? 0,
    projectCount: projectCounts.get(u.id) ?? 0,
    lastActiveAt: totalMap.get(u.id)?.last?.toISOString() ?? null,
    inviteEmailFailed: !!u.inviteEmailFailedAt,
    deletedAt: u.deletedAt?.toISOString() ?? null,
  }));
}
