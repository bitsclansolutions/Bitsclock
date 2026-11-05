import { prisma } from "./prisma";
import { ApiError } from "./api";
import { hasPermission, type SessionUser } from "./auth";
import type { Permission } from "./permissions";

export type ProjectKind = "project" | "activity";

export type ProjectDTO = {
  id: string;
  name: string;
  description: string;
  color: string;
  isArchived: boolean;
  billable: boolean;
  /** "project" = client/internal work; "activity" = non-project bucket (lunch, meetings). */
  kind: ProjectKind;
  createdAt: string;
  /** "all": every member may log time. "selected": only `memberIds`. */
  memberMode: "all" | "selected";
  memberIds: string[];
  /** Whether the caller may log time against this project right now. */
  canLog: boolean;
  totalSeconds: number;
  entryCount: number;
  /** Members who have logged time on the project. */
  contributorCount: number;
  mySeconds: number;
};

/** Active user ids from the given list, deduplicated; throws when any id is unknown or inactive. */
export async function validateMemberIds(ids: string[]) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const users = await prisma.user.findMany({ where: { id: { in: unique }, isActive: true }, select: { id: true } });
  if (users.length !== unique.length) throw new ApiError(400, "One of the selected members doesn't exist or is deactivated.");
  return users.map((u) => u.id);
}

/** What the caller may see of the project list; the cache key depends on it. */
export function projectScope(me: SessionUser) {
  const seeAll = ["projects.manage", "time.view_all", "reports.view_all", "dashboard.team"].some((p) => hasPermission(me, p as Permission));
  const seeMembers = seeAll || hasPermission(me, "users.view");
  return { seeAll, seeMembers };
}

/**
 * Row-level scoping:
 * - Managers (projects.manage, time.view_all, reports.view_all or dashboard.team) see every
 *   project with team-wide totals and the member list.
 * - Everyone else sees only projects they may log time on (open to all, or they are on the
 *   team), with totals computed from their own entries and no member list.
 */
export async function loadProjects(me: SessionUser, includeArchived: boolean, seeAll: boolean, seeMembers: boolean): Promise<ProjectDTO[]> {
  const meId = me.id;
  const projects = await prisma.project.findMany({
    where: {
      ...(includeArchived ? {} : { isArchived: false }),
      ...(seeAll ? {} : { OR: [{ memberMode: "all" }, { members: { some: { userId: meId } } }] }),
    },
    include: { members: { select: { userId: true } } },
    // Projects first, then activities ("project" sorts after "activity", hence desc).
    orderBy: [{ isArchived: "asc" }, { kind: "desc" }, { name: "asc" }],
  });
  const scope = seeAll ? {} : { userId: meId };
  const [totals, mine, contributors] = await Promise.all([
    prisma.timeEntry.groupBy({ by: ["projectId"], where: { endTime: { not: null }, ...scope }, _sum: { durationSeconds: true }, _count: { _all: true } }),
    prisma.timeEntry.groupBy({ by: ["projectId"], where: { endTime: { not: null }, userId: meId }, _sum: { durationSeconds: true } }),
    prisma.timeEntry.groupBy({ by: ["projectId", "userId"], where: { projectId: { not: null }, ...scope } }),
  ]);
  const contributorCount = new Map<string, number>();
  for (const c of contributors) if (c.projectId) contributorCount.set(c.projectId, (contributorCount.get(c.projectId) ?? 0) + 1);
  const totalMap = new Map(totals.map((t) => [t.projectId, t]));
  const mineMap = new Map(mine.map((t) => [t.projectId, t._sum.durationSeconds ?? 0]));

  return projects.map((p) => {
    const memberIds = p.members.map((m) => m.userId);
    const memberMode = p.memberMode === "selected" ? "selected" : "all";
    return {
      id: p.id,
      name: p.name,
      description: p.description ?? "",
      color: p.color,
      isArchived: p.isArchived,
      billable: p.billable,
      kind: p.kind === "activity" ? "activity" : "project",
      createdAt: p.createdAt.toISOString(),
      memberMode,
      memberIds: seeMembers ? memberIds : memberIds.filter((id) => id === meId),
      canLog: !p.isArchived && (memberMode === "all" || memberIds.includes(meId)),
      totalSeconds: totalMap.get(p.id)?._sum.durationSeconds ?? 0,
      entryCount: totalMap.get(p.id)?._count._all ?? 0,
      contributorCount: contributorCount.get(p.id) ?? 0,
      mySeconds: mineMap.get(p.id) ?? 0,
    };
  });
}
