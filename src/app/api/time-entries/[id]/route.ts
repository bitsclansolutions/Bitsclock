import { handler, json, parseBody, requireId, requirePermission, type RouteParams } from "@/lib/api";
import { deleteEntry, updateEntry } from "@/lib/entries";
import { invalidateTags } from "@/lib/server-cache";
import { entryUpdateSchema } from "@/lib/validation";

// Ownership is enforced inside updateEntry/deleteEntry: only the owner or time.manage_all.
export const PATCH = handler<RouteParams<{ id: string }>>(async (req, { params }) => {
  const me = await requirePermission("time.track");
  const id = requireId((await params).id, "Time entry");
  const body = await parseBody(req, entryUpdateSchema);
  const entry = await updateEntry(me, id, body);
  invalidateTags("entries");
  return json({ entry });
});

export const DELETE = handler<RouteParams<{ id: string }>>(async (_req, { params }) => {
  const me = await requirePermission("time.track");
  const id = requireId((await params).id, "Time entry");
  await deleteEntry(me, id);
  invalidateTags("entries");
  return json({ ok: true });
});
