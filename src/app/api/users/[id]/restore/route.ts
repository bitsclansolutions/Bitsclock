import { handler, json, requireAdmin, requireId, type RouteParams } from "@/lib/api";
import { restoreMember } from "@/lib/member-admin";
import { clientIp } from "@/lib/rate-limit";

/** Undo a member delete (Administrator only, D-011). The member comes back deactivated. */
export const POST = handler<RouteParams<{ id: string }>>(async (req, { params }) => {
  const me = await requireAdmin();
  const id = requireId((await params).id, "Member");
  await restoreMember(me, id, clientIp(req));
  return json({ ok: true });
});
