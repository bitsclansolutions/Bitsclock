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
};

/**
 * Member list.
 * - full (users.view): every member with email, status, running timer and totals.
 * - otherwise (pickers): active members with id, name and role only.
 */
export async function loadMembers(weekStart: Date, full: boolean): Promise<MemberDTO[]> {
  const users = await prisma.user.findMany({
    where: full ? {} : { isActive: true },
    include: { role: { select: { id: true, name: true, color: true } } },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });
  if (!full) {
    return users.map((u) => ({ id: u.id, name: u.name, email: "", jobTitle: "", isActive: true, createdAt: "", role: u.role, running: false, weekSeconds: 0, totalSeconds: 0, projectCount: 0, lastActiveAt: null }));
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
    email: u.email,
    jobTitle: u.jobTitle ?? "",
    isActive: u.isActive,
    createdAt: u.createdAt.toISOString(),
    role: u.role,
    running: runningSet.has(u.id),
    weekSeconds: weekMap.get(u.id) ?? 0,
    totalSeconds: totalMap.get(u.id)?.seconds ?? 0,
    projectCount: projectCounts.get(u.id) ?? 0,
    lastActiveAt: totalMap.get(u.id)?.last?.toISOString() ?? null,
  }));
}
