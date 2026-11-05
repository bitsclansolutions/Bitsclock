import { prisma } from "@/lib/prisma";
import { ApiError, handler, json, parseBody, requireAdmin, requireId, type RouteParams } from "@/lib/api";
import { audit } from "@/lib/audit";
import { createMember } from "@/lib/member-admin";
import { memberRequestDecisionSchema } from "@/lib/validation";
import { clientIp } from "@/lib/rate-limit";

const ALREADY = "This request has already been decided.";

/**
 * The Administrator approves or rejects a member request (D-001).
 * Approve: re-checks the role and email, creates the member and marks the request approved
 * in one transaction, then sends the invitation. The status change is conditional on the
 * request still being pending, so two approvals can never both run.
 */
export const POST = handler<RouteParams<{ id: string }>>(async (req, { params }) => {
  const me = await requireAdmin();
  const id = requireId((await params).id, "Request");
  const body = await parseBody(req, memberRequestDecisionSchema);
  const ip = clientIp(req);
  const request = await prisma.memberRequest.findUnique({ where: { id } });
  if (!request) throw new ApiError(404, "Request not found.");
  if (request.status !== "pending") throw new ApiError(409, ALREADY);

  if (body.decision === "reject") {
    await prisma.$transaction(async (tx) => {
      const res = await tx.memberRequest.updateMany({
        where: { id, status: "pending" },
        data: { status: "rejected", decidedById: me.id, decidedAt: new Date(), note: body.note || request.note },
      });
      if (res.count === 0) throw new ApiError(409, ALREADY);
      await audit({ actor: me, action: "member_request.reject", targetType: "member_request", targetId: id, summary: `Rejected the request for ${request.name} (${request.email})`, ip }, tx);
    });
    return json({ ok: true, status: "rejected" });
  }

  const result = await createMember(
    me,
    { name: request.name, email: request.email, jobTitle: request.jobTitle ?? "", roleId: request.roleId, password: body.password },
    { req, ip },
    async (tx, userId) => {
      const res = await tx.memberRequest.updateMany({
        where: { id, status: "pending" },
        data: { status: "approved", decidedById: me.id, decidedAt: new Date(), createdUserId: userId },
      });
      if (res.count === 0) throw new ApiError(409, ALREADY);
      await audit({ actor: me, action: "member_request.approve", targetType: "member_request", targetId: id, summary: `Approved the request for ${request.name} (${request.email})`, ip }, tx);
    },
  );
  return json({ ...result, status: "approved" }, { status: 201, headers: { "Cache-Control": "no-store" } });
});
