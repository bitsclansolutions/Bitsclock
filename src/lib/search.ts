import { z } from "zod";
import { prisma } from "./prisma";
import { hasPermission, type SessionUser } from "./auth";
import { entryInclude, serializeEntry, type EntryDTO } from "./entries";
import { projectScope } from "./projects";

export const searchQuerySchema = z
  .object({ q: z.string().trim().min(2, "Type at least 2 characters.").max(100) })
  .strict();

export type SearchDTO = {
  /** Null when the caller may not see that kind of data at all. */
  entries: EntryDTO[] | null;
  projects: { id: string; name: string; color: string; isArchived: boolean; kind: string }[] | null;
  members: { id: string; name: string; jobTitle: string | null; email: string; role: { name: string; color: string } }[] | null;
  roles: { id: string; name: string; color: string }[] | null;
};

const PER_GROUP = 6;

/**
 * Searches everything the caller may see, over all time, with the same row-level
 * scoping as the list endpoints:
 * - entries: own entries (time.track), everyone's with time.view_all; matched on
 *   description, project name and (team-wide only) member name;
 * - projects: all with manager permissions, otherwise only the ones they may log time on;
 * - members: only with users.view or users.manage (the member-list permissions);
 * - roles: only for roles.manage.
 */
export async function search(me: SessionUser, q: string): Promise<SearchDTO> {
  const has = (p: Parameters<typeof hasPermission>[1]) => hasPermission(me, p);
  const like = { contains: q, mode: "insensitive" as const };

  const seeAllEntries = has("time.view_all");
  const canEntries = has("time.track") || seeAllEntries;
  const canProjects = has("projects.view") || has("projects.manage");
  // Members only for roles that may see the member list; time or report permissions alone don't count.
  const canMembers = has("users.view") || has("users.manage");
  const canRoles = has("roles.manage");
  const { seeAll: seeAllProjects } = projectScope(me);

  const [entries, projects, members, roles] = await Promise.all([
    canEntries
      ? prisma.timeEntry
          .findMany({
            where: {
              ...(seeAllEntries ? {} : { userId: me.id }),
              OR: [{ description: like }, { project: { name: like } }, ...(seeAllEntries ? [{ user: { name: like } }] : [])],
            },
            include: entryInclude,
            orderBy: [{ startTime: "desc" }, { id: "desc" }],
            take: PER_GROUP * 2,
          })
          .then((rows) => rows.map(serializeEntry))
      : null,
    canProjects
      ? prisma.project.findMany({
          where: {
            OR: [{ name: like }, { description: like }],
            ...(seeAllProjects ? {} : { AND: [{ OR: [{ memberMode: "all" }, { members: { some: { userId: me.id } } }] }] }),
          },
          select: { id: true, name: true, color: true, isArchived: true, kind: true },
          orderBy: [{ isArchived: "asc" }, { name: "asc" }],
          take: PER_GROUP,
        })
      : null,
    canMembers
      ? prisma.user
          .findMany({
            where: { deletedAt: null, OR: [{ name: like }, { jobTitle: like }, { email: like }] },
            select: { id: true, name: true, jobTitle: true, email: true, role: { select: { name: true, color: true } } },
            orderBy: { name: "asc" },
            take: PER_GROUP,
          })
      : null,
    canRoles
      ? prisma.role.findMany({ where: { OR: [{ name: like }, { description: like }] }, select: { id: true, name: true, color: true }, orderBy: { name: "asc" }, take: PER_GROUP })
      : null,
  ]);
  return { entries, projects, members, roles };
}
