import { prisma } from "@/lib/prisma";
import { ApiError, handler, json, parseBody, requireId, requirePermission, type RouteParams } from "@/lib/api";
import { projectUpdateSchema } from "@/lib/validation";
import { validateMemberIds } from "@/lib/projects";
import { invalidateTags } from "@/lib/server-cache";

export const PATCH = handler<RouteParams<{ id: string }>>(async (req, { params }) => {
  await requirePermission("projects.manage");
  const id = requireId((await params).id, "Project");
  const body = await parseBody(req, projectUpdateSchema);
  const existing = await prisma.project.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "Project not found.");

  const nextMode = body.memberMode ?? (existing.memberMode === "selected" ? "selected" : "all");
  const memberIds = body.memberIds !== undefined ? await validateMemberIds(body.memberIds) : undefined;
  if (nextMode === "selected" && memberIds !== undefined && memberIds.length === 0) {
    throw new ApiError(400, "Pick at least one member, or allow all members.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.project.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.color !== undefined ? { color: body.color } : {}),
        ...(body.billable !== undefined ? { billable: body.billable } : {}),
        ...(body.isArchived !== undefined ? { isArchived: body.isArchived } : {}),
        ...(body.memberMode !== undefined ? { memberMode: body.memberMode } : {}),
        ...(body.kind !== undefined ? { kind: body.kind } : {}),
      },
    });
    if (memberIds !== undefined || nextMode === "all") {
      await tx.projectMember.deleteMany({ where: { projectId: id } });
      if (nextMode === "selected" && memberIds?.length) {
        await tx.projectMember.createMany({ data: memberIds.map((userId) => ({ projectId: id, userId })) });
      }
    }
  });
  // Entries embed the project's name, colour and billable flag, so drop those too.
  invalidateTags("projects", "entries");
  return json({ ok: true });
});

export const DELETE = handler<RouteParams<{ id: string }>>(async (_req, { params }) => {
  await requirePermission("projects.manage");
  const id = requireId((await params).id, "Project");
  const existing = await prisma.project.findUnique({ where: { id }, include: { _count: { select: { timeEntries: true } } } });
  if (!existing) throw new ApiError(404, "Project not found.");
  if (existing._count.timeEntries > 0) {
    throw new ApiError(409, `"${existing.name}" has ${existing._count.timeEntries} time entries. Archive it instead of deleting.`);
  }
  await prisma.project.delete({ where: { id } });
  invalidateTags("projects");
  return json({ ok: true });
});
