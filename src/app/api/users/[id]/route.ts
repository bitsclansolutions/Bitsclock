import { prisma } from "@/lib/prisma";
import { ApiError, handler, json, parseBody, requireAdmin, requireId, requireUser, type RouteParams } from "@/lib/api";
import { hasPermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { userUpdateSchema } from "@/lib/validation";
import { invalidateTags } from "@/lib/server-cache";
import { revokeCredentialsTx } from "@/lib/sessions";
import { assignableRole, deactivateMember, deleteMember, isAdminRow } from "@/lib/member-admin";
import { clientIp } from "@/lib/rate-limit";

/**
 * Change a member (D-001).
 * - The Administrator may change name, job title, email, role and active status of any
 *   member. Its own account keeps its role and stays active (there is exactly one admin);
 *   its own password is changed from Profile, which asks for the current one.
 * - A holder of users.deactivate may only send `{ isActive: false }` for a non-admin member
 *   other than themselves.
 * - Role changes, deactivation and email changes end the member's sessions and pending
 *   reset codes in the same transaction as the change (D-003, R-065).
 */
export const PATCH = handler<RouteParams<{ id: string }>>(async (req, { params }) => {
  const me = await requireUser();
  const id = requireId((await params).id, "Member");
  const body = await parseBody(req, userUpdateSchema);
  const ip = clientIp(req);
  const changed = Object.entries(body).filter(([, v]) => v !== undefined).map(([k]) => k);

  if (!me.isAdmin) {
    if (!hasPermission(me, "users.deactivate")) throw new ApiError(403, "Only the Administrator can do that.");
    if (changed.length !== 1 || changed[0] !== "isActive" || body.isActive !== false) {
      throw new ApiError(403, "Only the Administrator can change members. You can deactivate members.");
    }
    await deactivateMember(me, id, ip);
    return json({ ok: true });
  }

  if (body.isActive === false) {
    if (changed.length > 1) throw new ApiError(400, "Deactivate a member on its own, without other changes.");
    await deactivateMember(me, id, ip);
    return json({ ok: true });
  }

  const user = await prisma.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id }, include: { role: true } });
    if (!target || target.deletedAt) throw new ApiError(404, "Member not found.");
    const targetIsAdmin = isAdminRow(target);
    const roleChange = body.roleId !== undefined && body.roleId !== target.roleId;
    const emailChange = body.email !== undefined && body.email !== target.email;
    const reactivate = body.isActive === true && !target.isActive;

    if (roleChange && (targetIsAdmin || id === me.id)) throw new ApiError(400, "The Administrator's role can't be changed.");
    const newRole = roleChange ? await assignableRole(body.roleId!, tx) : null;
    if (emailChange) {
      const exists = await tx.user.findUnique({ where: { email: body.email! }, select: { id: true } });
      if (exists) throw new ApiError(409, "A member with this email already exists.");
    }

    const updated = await tx.user.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.jobTitle !== undefined ? { jobTitle: body.jobTitle } : {}),
        ...(emailChange ? { email: body.email } : {}),
        ...(newRole ? { roleId: newRole.id } : {}),
        ...(reactivate ? { isActive: true } : {}),
        ...(roleChange ? { tokenVersion: { increment: 1 } } : {}),
      },
      include: { role: { select: { id: true, name: true, color: true } } },
    });
    // A role change must apply on every device at once; an email change voids reset codes sent to the old address.
    if (roleChange) await revokeCredentialsTx(tx, id);
    else if (emailChange) await tx.passwordReset.deleteMany({ where: { userId: id, usedAt: null } });

    if (newRole) await audit({ actor: me, action: "user.role_change", targetType: "user", targetId: id, summary: `Changed ${target.name}'s role from ${target.role.name} to ${newRole.name}`, ip }, tx);
    if (reactivate) await audit({ actor: me, action: "user.reactivate", targetType: "user", targetId: id, summary: `Reactivated ${target.name}`, ip }, tx);
    const details = changed.filter((k) => ["name", "jobTitle", "email"].includes(k));
    if (details.length) {
      await audit(
        { actor: me, action: "user.update", targetType: "user", targetId: id, summary: `Updated ${target.name}: ${details.join(", ")}`, meta: emailChange ? { from: target.email, to: body.email! } : undefined, ip },
        tx,
      );
    }
    return updated;
  });
  invalidateTags("users");
  return json({ member: { id: user.id, name: user.name, email: user.email, jobTitle: user.jobTitle ?? "", isActive: user.isActive, role: user.role } });
});

/**
 * Delete a member (Administrator only, D-011). A soft delete: the account is gone from the
 * app, but the user row stays so their time entries keep their owner (D-006 still holds: the
 * row is never removed). The Administrator can restore it from the Team page.
 */
export const DELETE = handler<RouteParams<{ id: string }>>(async (req, { params }) => {
  const me = await requireAdmin();
  const id = requireId((await params).id, "Member");
  await deleteMember(me, id, clientIp(req));
  return json({ ok: true });
});
