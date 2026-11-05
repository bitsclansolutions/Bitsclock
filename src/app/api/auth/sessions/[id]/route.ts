import { ApiError, handler, json, requireId, requireUser, type RouteParams } from "@/lib/api";
import { revokeSessionById } from "@/lib/sessions";
import { invalidateTags } from "@/lib/server-cache";

/**
 * Sign out one of the caller's own devices. The row must belong to the caller. That
 * device's access token is refused from the next request on (it carries the session id, R-060).
 */
export const DELETE = handler<RouteParams<{ id: string }>>(async (_req, { params }) => {
  const me = await requireUser();
  const id = requireId((await params).id, "Session");
  const ok = await revokeSessionById(me.id, id);
  if (!ok) throw new ApiError(404, "Session not found.");
  invalidateTags("users");
  return json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
});
