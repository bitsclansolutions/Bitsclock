import { handler, jsonCached, requireUser } from "@/lib/api";
import { hasPermission, type SessionUser } from "@/lib/auth";
import { getActiveEntry, type EntryDTO } from "@/lib/entries";
import { loadMembers, type MemberDTO } from "@/lib/members";
import { loadProjects, projectScope, type ProjectDTO } from "@/lib/projects";
import { cached, entryTags } from "@/lib/server-cache";

export type BootstrapDTO = {
  user: SessionUser;
  /** Projects the caller may see; null when they lack projects.view. */
  projects: ProjectDTO[] | null;
  /** Member list for pickers and the team page; null when they may not list members. */
  members: MemberDTO[] | null;
  /** The caller's running timer, if any. */
  active: EntryDTO | null;
};

/**
 * Everything the app shell needs after sign-in, in one round trip instead of three or
 * four. The client seeds its per-URL cache with these so the first page renders without
 * waiting on /api/projects, /api/users and /api/time-entries/active separately.
 */
export const GET = handler(async (req) => {
  const me = await requireUser();
  const { seeAll, seeMembers } = projectScope(me);
  const canProjects = hasPermission(me, "projects.view");
  const fullMembers = hasPermission(me, "users.view");
  const canMembers = fullMembers || hasPermission(me, "time.view_all") || hasPermission(me, "reports.view_all") || hasPermission(me, "projects.manage");
  // Team member lists and team project totals depend on everyone's time; otherwise only on the caller's (R-030).
  const entryTag = canMembers || seeAll ? entryTags(undefined) : entryTags([me.id]);
  const data = await cached<BootstrapDTO>(`bootstrap:${me.id}`, { ttlMs: 15_000, tags: ["users", "roles", "projects", ...entryTag] }, async () => {
    const [projects, members, active] = await Promise.all([
      canProjects ? loadProjects(me, false, seeAll, seeMembers) : Promise.resolve(null),
      canMembers ? loadMembers(new Date(NaN), fullMembers) : Promise.resolve(null),
      getActiveEntry(me.id),
    ]);
    return { user: me, projects, members, active };
  });
  return jsonCached(req, data, { maxAge: 5, swr: 30 });
});
