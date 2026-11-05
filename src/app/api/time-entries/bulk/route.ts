import { ApiError, handler, json, parseBody, requirePermission } from "@/lib/api";
import { hasPermission } from "@/lib/auth";
import { createManualEntries, deleteEntries, type EntryDTO } from "@/lib/entries";
import { invalidateEntries } from "@/lib/server-cache";
import { entriesBulkCreateSchema, entriesBulkDeleteSchema } from "@/lib/validation";

export type BulkCreateResponse = {
  created: { index: number; entry: EntryDTO }[];
  /** Only in non-atomic mode: rows that were rejected, by their index in the request. */
  errors: { index: number; message: string }[];
};

/**
 * Create up to MAX_BULK_ROWS manual entries in one request (timesheet fill, imports,
 * offline sync). Atomic by default: any invalid row rejects the whole batch with its
 * number in the message. Send `atomic: false` to keep the valid rows and get per-row
 * errors. Same rules as single entries (overlap, 24 h, lock date, billable).
 */
export const POST = handler(async (req) => {
  const me = await requirePermission("time.track");
  const body = await parseBody(req, entriesBulkCreateSchema);
  const targetUserId = body.userId && body.userId !== "me" ? body.userId : me.id;
  if (targetUserId !== me.id && !hasPermission(me, "time.manage_all")) throw new ApiError(403, "You can only log time for yourself.");
  const result = await createManualEntries(me, targetUserId, body.entries, body.atomic);
  if (result.created.length) invalidateEntries(targetUserId);
  return json(result satisfies BulkCreateResponse, { status: result.created.length ? 201 : 400 });
});

/** Delete up to 500 entries by id. Own entries only unless time.manage_all; locked-period entries are skipped. */
export const DELETE = handler(async (req) => {
  const me = await requirePermission("time.track");
  const { ids } = await parseBody(req, entriesBulkDeleteSchema);
  const { userIds, ...result } = await deleteEntries(me, ids);
  if (result.deleted) invalidateEntries(...userIds);
  return json(result);
});
