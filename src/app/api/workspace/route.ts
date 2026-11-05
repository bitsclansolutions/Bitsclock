import { prisma } from "@/lib/prisma";
import { handler, json, parseBody, requireAdmin, requireUser } from "@/lib/api";
import { audit } from "@/lib/audit";
import { getWorkspace, WORKSPACE_ID } from "@/lib/workspace";
import { invalidateTags } from "@/lib/server-cache";
import { workspaceUpdateSchema } from "@/lib/validation";
import { clientIp } from "@/lib/rate-limit";

/** Workspace settings everyone needs to see (the lock date, so editors can explain refusals). */
export const GET = handler(async () => {
  await requireUser();
  return json(await getWorkspace(), { headers: { "Cache-Control": "private, max-age=30" } });
});

/** Set or clear the invoicing lock date (Administrator only, D-005). Audited. */
export const PATCH = handler(async (req) => {
  const me = await requireAdmin();
  const { lockDate } = await parseBody(req, workspaceUpdateSchema);
  const value = lockDate ? new Date(lockDate) : null;
  await prisma.$transaction(async (tx) => {
    const before = await tx.workspaceSettings.findUnique({ where: { id: WORKSPACE_ID } });
    await tx.workspaceSettings.upsert({
      where: { id: WORKSPACE_ID },
      create: { id: WORKSPACE_ID, lockDate: value, updatedById: me.id },
      update: { lockDate: value, updatedById: me.id },
    });
    await audit(
      {
        actor: me,
        action: "workspace.lock_date",
        targetType: "workspace",
        targetId: WORKSPACE_ID,
        summary: value ? `Locked time before ${value.toISOString().slice(0, 10)}` : "Removed the lock date",
        meta: { from: before?.lockDate?.toISOString() ?? null, to: value?.toISOString() ?? null },
        ip: clientIp(req),
      },
      tx,
    );
  });
  invalidateTags("settings");
  return json(await getWorkspace());
});
