import { prisma } from "./prisma";
import { ApiError } from "./api";
import type { SessionUser } from "./auth";
import { cached } from "./server-cache";

const ID = "workspace";

export type WorkspaceDTO = { lockDate: string | null };

/** Workspace settings (one row). Cached; PATCH /api/workspace invalidates the "settings" tag. */
export async function getWorkspace(): Promise<WorkspaceDTO> {
  return cached("workspace", { ttlMs: 60_000, tags: ["settings"] }, async () => {
    const row = await prisma.workspaceSettings.findUnique({ where: { id: ID } });
    return { lockDate: row?.lockDate?.toISOString() ?? null };
  });
}

/**
 * Locked periods (D-005): entries starting before the workspace lock date are invoiced and
 * only the Administrator may create, edit or delete them. Pass every instant the write
 * touches (old and new start).
 */
export async function assertUnlocked(actor: Pick<SessionUser, "isAdmin">, ...instants: (Date | null | undefined)[]) {
  if (actor.isAdmin) return;
  const { lockDate } = await getWorkspace();
  if (!lockDate) return;
  const lock = new Date(lockDate);
  if (instants.some((d) => d && d < lock)) {
    const day = lock.toISOString().slice(0, 10);
    throw new ApiError(403, `Time before ${day} is locked because it has been invoiced. Ask the Administrator if it needs a change.`);
  }
}

/** The lock date for bulk filters, or null; admins are never limited. */
export async function lockDateFor(actor: Pick<SessionUser, "isAdmin">): Promise<Date | null> {
  if (actor.isAdmin) return null;
  const { lockDate } = await getWorkspace();
  return lockDate ? new Date(lockDate) : null;
}

export { ID as WORKSPACE_ID };
