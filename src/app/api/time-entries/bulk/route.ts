import { prisma } from "@/lib/prisma";
import { ApiError, handler, json, parseBody, requirePermission } from "@/lib/api";
import { hasPermission } from "@/lib/auth";
import { createManualEntries, type EntryDTO } from "@/lib/entries";
import { invalidateTags } from "@/lib/server-cache";
import { entriesBulkCreateSchema, entriesBulkDeleteSchema } from "@/lib/validation";

export type BulkCreateResponse = {
  created: { index: number; entry: EntryDTO }[];
  /** Only in non-atomic mode: rows that were rejected, by their index in the request. */
  errors: { index: number; message: string }[];
};

/**
 * Create up to 200 manual entries in one request (timesheet fill, imports, offline
 * sync). Atomic by default: any invalid row rejects the whole batch with its index in
 * the message. Send `atomic: false` to keep the valid rows and get per-row errors.
 * Carries the same Idempotency-Key protection as every other mutation.
 */
export const POST = handler(async (req) => {
  const me = await requirePermission("time.track");
  const body = await parseBody(req, entriesBulkCreateSchema);
  const targetUserId = body.userId && body.userId !== "me" ? body.userId : me.id;
  if (targetUserId !== me.id && !hasPermission(me, "time.manage_all")) throw new ApiError(403, "You can only log time for yourself.");
  const result = await createManualEntries(targetUserId, body.entries, body.atomic);
  invalidateTags("entries");
  return json(result satisfies BulkCreateResponse, { status: result.created.length ? 201 : 400 });
});

/** Delete up to 500 entries by id. Only the caller's own entries unless they hold time.manage_all. */
export const DELETE = handler(async (req) => {
  const me = await requirePermission("time.track");
  const { ids } = await parseBody(req, entriesBulkDeleteSchema);
  const where = hasPermission(me, "time.manage_all") ? { id: { in: ids } } : { id: { in: ids }, userId: me.id };
  const { count } = await prisma.timeEntry.deleteMany({ where });
  invalidateTags("entries");
  return json({ deleted: count, skipped: ids.length - count });
});
