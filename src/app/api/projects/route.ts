import { prisma } from "@/lib/prisma";
import { ApiError, handler, json, jsonCached, parseBody, parseQuery, requireAnyPermission, requirePermission } from "@/lib/api";
import { PROJECT_LIST_PERMISSIONS } from "@/lib/permissions";
import { projectCreateSchema, projectsQuerySchema } from "@/lib/validation";
import { loadProjects, projectScope, validateMemberIds } from "@/lib/projects";
import { PROJECT_COLORS } from "@/lib/time";
import { cached, entryTags, invalidateTags } from "@/lib/server-cache";

export type { ProjectDTO } from "@/lib/projects";

/**
 * Project list, scoped to what the caller may see (see loadProjects). Open to anyone who
 * tracks time or reports on it, not only projects.view: the tracker needs the projects a
 * member was added to, and the scoping keeps everyone else's projects out.
 */
export const GET = handler(async (req) => {
  const me = await requireAnyPermission(...PROJECT_LIST_PERMISSIONS);
  const { includeArchived } = parseQuery(new URL(req.url), projectsQuerySchema);
  const { seeAll, seeMembers } = projectScope(me);
  const projects = await cached(
    `projects:${me.id}:${includeArchived === "1" ? 1 : 0}:${seeAll ? 1 : 0}${seeMembers ? 1 : 0}`,
    // Totals cover the team for managers and only the caller otherwise (R-030).
    { ttlMs: 30_000, tags: ["projects", ...entryTags(seeAll ? undefined : [me.id]), "users", "roles"] },
    () => loadProjects(me, includeArchived === "1", seeAll, seeMembers),
  );
  return jsonCached(req, { projects }, { maxAge: 15 });
});

export const POST = handler(async (req) => {
  const me = await requirePermission("projects.manage");
  const body = await parseBody(req, projectCreateSchema);
  const memberIds = body.memberMode === "selected" ? await validateMemberIds(body.memberIds) : [];
  if (body.memberMode === "selected" && memberIds.length === 0) throw new ApiError(400, "Pick at least one member, or allow all members.");
  const count = await prisma.project.count();
  const project = await prisma.project.create({
    data: {
      name: body.name,
      description: body.description,
      color: body.color ?? PROJECT_COLORS[count % PROJECT_COLORS.length]!,
      billable: body.billable,
      memberMode: body.memberMode,
      kind: body.kind,
      createdById: me.id,
      members: { create: memberIds.map((userId) => ({ userId })) },
    },
  });
  invalidateTags("projects");
  return json({ project: { id: project.id, name: project.name } }, { status: 201 });
});
