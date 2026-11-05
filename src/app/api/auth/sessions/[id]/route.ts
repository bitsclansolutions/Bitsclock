import { ApiError, handler, json, requireId, requireUser, type RouteParams } from "@/lib/api";
import { revokeSessionById } from "@/lib/sessions";

/** Sign out one of the caller's own devices. The row must belong to the caller. */
export const DELETE = handler<RouteParams<{ id: string }>>(async (_req, { params }) => {
  const me = await requireUser();
  const id = requireId((await params).id, "Session");
  const ok = await revokeSessionById(me.id, id);
  if (!ok) throw new ApiError(404, "Session not found.");
  return json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
});
