import { prisma } from "@/lib/prisma";
import { handler, json, parseBody, requireAdmin, requireUser } from "@/lib/api";
import { audit } from "@/lib/audit";
import { getWorkspace, lockDayLabel, WORKSPACE_ID } from "@/lib/workspace";
import { invalidateTags } from "@/lib/server-cache";
import { workspaceUpdateSchema } from "@/lib/validation";
import { clientIp } from "@/lib/rate-limit";

/** Workspace settings everyone needs to see (the lock date, so editors can explain refusals). */
export const GET = handler(async () => {
  await requireUser();
  return json(await getWorkspace(), { headers: { "Cache-Control": "private, max-age=30" } });
});

/** Set or clear the invoicing lock date (D-005) and/or set the workspace time zone (D-012). Administrator only, audited. */
export const PATCH = handler(async (req) => {
  const me = await requireAdmin();
  const { lockDate, timeZone } = await parseBody(req, workspaceUpdateSchema);
  const data: { lockDate?: Date | null; timeZone?: string } = {};
  if (lockDate !== undefined) data.lockDate = lockDate ? new Date(lockDate) : null;
  if (timeZone !== undefined) data.timeZone = timeZone;
  await prisma.$transaction(async (tx) => {
    const before = await tx.workspaceSettings.findUnique({ where: { id: WORKSPACE_ID } });
    await tx.workspaceSettings.upsert({
      where: { id: WORKSPACE_ID },
      create: { id: WORKSPACE_ID, ...data, updatedById: me.id },
      update: { ...data, updatedById: me.id },
    });
    const ip = clientIp(req);
    if (data.lockDate !== undefined) {
      const value = data.lockDate;
      await audit(
        {
          actor: me,
          action: "workspace.lock_date",
          targetType: "workspace",
          targetId: WORKSPACE_ID,
          summary: value ? `Locked time before ${await lockDayLabel(value)}` : "Removed the lock date",
          meta: { from: before?.lockDate?.toISOString() ?? null, to: value?.toISOString() ?? null },
          ip,
        },
        tx,
      );
    }
    if (data.timeZone !== undefined) {
      await audit(
        {
          actor: me,
          action: "workspace.time_zone",
          targetType: "workspace",
          targetId: WORKSPACE_ID,
          summary: `Set the workspace time zone to ${data.timeZone}`,
          meta: { from: before?.timeZone ?? null, to: data.timeZone },
          ip,
        },
        tx,
      );
    }
  });
  invalidateTags("settings");
  return json(await getWorkspace());
});
