import { prisma, Prisma } from "@/lib/prisma";
import { ApiError, handler, json, parseBody, requirePermission, requireUser } from "@/lib/api";
import { hasPermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { listMemberRequests } from "@/lib/member-requests";
import { assignableRole } from "@/lib/member-admin";
import { memberRequestCreateSchema } from "@/lib/validation";
import { clientIp } from "@/lib/rate-limit";

/** The Administrator's queue, or the caller's own requests (D-001). */
export const GET = handler(async () => {
  const me = await requireUser();
  if (!me.isAdmin && !hasPermission(me, "users.request")) throw new ApiError(403, "You don't have permission to see member requests.");
  const requests = await listMemberRequests(me);
  return json({ requests }, { headers: { "Cache-Control": "no-store" } });
});

/** Ask the Administrator to add a member. The requested role can never be Administrator. */
export const POST = handler(async (req) => {
  const me = await requirePermission("users.request");
  const body = await parseBody(req, memberRequestCreateSchema);
  try {
    const request = await prisma.$transaction(async (tx) => {
      const role = await assignableRole(body.roleId, tx);
      const exists = await tx.user.findUnique({ where: { email: body.email }, select: { id: true } });
      if (exists) throw new ApiError(409, "A member with this email already exists.");
      const r = await tx.memberRequest.create({
        data: { name: body.name, email: body.email, jobTitle: body.jobTitle || null, note: body.note || null, roleId: role.id, requestedById: me.id },
      });
      await audit({ actor: me, action: "member_request.create", targetType: "member_request", targetId: r.id, summary: `Requested ${body.name} (${body.email}) as ${role.name}`, ip: clientIp(req) }, tx);
      return r;
    });
    return json({ request: { id: request.id } }, { status: 201 });
  } catch (e) {
    // The partial unique index allows one pending request per email.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ApiError(409, "There's already a pending request for this email.");
    throw e;
  }
});
