import { handler, json, requireId, requirePermission, type RouteParams } from "@/lib/api";
import { stopTimer } from "@/lib/entries";
import { invalidateTags } from "@/lib/server-cache";

// stopTimer checks ownership: only the owner or time.manage_all may stop a timer.
export const POST = handler<RouteParams<{ id: string }>>(async (_req, { params }) => {
  const me = await requirePermission("time.track");
  const id = requireId((await params).id, "Timer");
  const entry = await stopTimer(me, id);
  invalidateTags("entries");
  return json({ entry });
});
