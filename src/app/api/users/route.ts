import { ApiError, handler, json, jsonCached, parseBody, parseQuery, requireAdmin, requireUser } from "@/lib/api";
import { hasPermission } from "@/lib/auth";
import { userCreateSchema, usersQuerySchema } from "@/lib/validation";
import { cached } from "@/lib/server-cache";
import { loadMembers } from "@/lib/members";
import { createMember } from "@/lib/member-admin";
import { clientIp } from "@/lib/rate-limit";

export type { MemberDTO } from "@/lib/members";

/**
 * Row-level scoping:
 * - users.view or users.deactivate (Team page): every member with email, status, running timer and weekly hours.
 * - time.view_all / reports.view_all / projects.manage (pickers only): active members with
 *   id, name and role; email and activity are withheld.
 * - Anyone else: 403.
 */
export const GET = handler(async (req) => {
  const me = await requireUser();
  const full = hasPermission(me, "users.view") || hasPermission(me, "users.deactivate");
  const canList = full || hasPermission(me, "time.view_all") || hasPermission(me, "reports.view_all") || hasPermission(me, "projects.manage");
  if (!canList) throw new ApiError(403, "You don't have permission to see members.");

  const q = parseQuery(new URL(req.url), usersQuerySchema);
  if (q.deleted === "1") {
    if (!me.isAdmin) throw new ApiError(403, "Only the Administrator can see deleted members.");
    const ws = q.weekStart ? new Date(q.weekStart) : new Date(NaN);
    return json({ members: await loadMembers(ws, true, { deleted: true }) }, { headers: { "Cache-Control": "no-store" } });
  }
  const weekStart = full && q.weekStart ? new Date(q.weekStart) : new Date(NaN);
  const key = Number.isNaN(weekStart.getTime()) ? "" : weekStart.toISOString();
  const members = await cached(`users:${full ? "full" : "min"}:${key}`, { ttlMs: 30_000, tags: ["users", "roles", "entries"] }, () => loadMembers(weekStart, full));
  return jsonCached(req, { members }, { maxAge: 15 });
});

/**
 * Add a member (Administrator only, D-001). The temporary password is the one the
 * Administrator typed, or a generated one. The invitation email carries the sign-in link
 * and the password; when it couldn't be sent the password is returned once so it can be
 * passed on another way. It is never stored anywhere in plain text (R-015).
 */
export const POST = handler(async (req) => {
  const me = await requireAdmin();
  const body = await parseBody(req, userCreateSchema);
  const result = await createMember(me, body, { req, ip: clientIp(req) });
  return json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
});
