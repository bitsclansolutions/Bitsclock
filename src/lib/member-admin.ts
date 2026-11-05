import bcrypt from "bcryptjs";
import { prisma, Prisma, type Tx } from "./prisma";
import { ApiError } from "./api";
import type { SessionUser } from "./auth";
import { audit } from "./audit";
import { ADMIN_ROLE_NAME } from "./permissions";
import { generateTempPassword } from "./password-reset";
import { appUrl, invitationEmail, sendMail } from "./mail";
import { revokeCredentialsTx } from "./sessions";
import { invalidateEntries, invalidateTags } from "./server-cache";
import { stopRunningTimerTx } from "./entries";

/**
 * Member administration shared by the Team routes and request approval (D-001, D-003).
 * - Nobody can be given the Administrator role through the app; there is exactly one.
 * - The Administrator account can't be demoted, deactivated or deleted through any route.
 * - Every change that must end someone's sessions does it in the same transaction.
 */

type Actor = Pick<SessionUser, "id" | "name">;

/** Loads a role that may be assigned to a member: it must exist and must not be Administrator. */
export async function assignableRole(roleId: string, db: Pick<Tx, "role"> = prisma) {
  const role = await db.role.findUnique({ where: { id: roleId } });
  if (!role) throw new ApiError(400, "Choose a valid role.");
  if (role.name === ADMIN_ROLE_NAME) throw new ApiError(403, "The Administrator role can't be assigned. There is exactly one Administrator.");
  return role;
}

export function isAdminRow(u: { role: { name: string } }) {
  return u.role.name === ADMIN_ROLE_NAME;
}

export type CreatedMember = {
  member: { id: string; name: string; email: string; role: { id: string; name: string; color: string } };
  emailSent: boolean;
  /** Only when the invitation couldn't be emailed, so the Administrator can pass it on. Never stored. */
  tempPassword?: string;
};

/**
 * Create a member and email the invitation. `afterCreate` runs inside the same transaction
 * (request approval uses it to mark the request approved atomically).
 */
export async function createMember(
  actor: Actor,
  input: { name: string; email: string; jobTitle?: string; roleId: string; password?: string },
  meta: { req: Request; ip: string | null },
  afterCreate?: (tx: Tx, userId: string) => Promise<void>,
): Promise<CreatedMember> {
  // Resolve the link first: a missing APP_URL must fail before anything is written.
  const url = appUrl(meta.req);
  const password = input.password ?? generateTempPassword();
  const passwordHash = await bcrypt.hash(password, 10);
  let user;
  try {
    user = await prisma.$transaction(async (tx) => {
      const role = await assignableRole(input.roleId, tx);
      const exists = await tx.user.findUnique({ where: { email: input.email }, select: { id: true } });
      if (exists) throw new ApiError(409, "A member with this email already exists.");
      const created = await tx.user.create({
        data: { name: input.name, email: input.email, jobTitle: input.jobTitle || null, roleId: role.id, passwordHash },
        include: { role: { select: { id: true, name: true, color: true } } },
      });
      await audit({ actor, action: "user.create", targetType: "user", targetId: created.id, summary: `Added ${created.name} (${created.email}) as ${role.name}`, ip: meta.ip }, tx);
      if (afterCreate) await afterCreate(tx, created.id);
      return created;
    });
  } catch (e) {
    // Two admins (or a double click) creating the same email at once: the unique index decides.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ApiError(409, "A member with this email already exists.");
    throw e;
  }
  invalidateTags("users");
  const emailSent = await sendMail(invitationEmail({ to: user.email, name: user.name, invitedBy: actor.name, password, url }));
  await recordEmailOutcome(user.id, emailSent, actor, `invitation to ${user.email}`, meta.ip);
  return {
    member: { id: user.id, name: user.name, email: user.email, role: user.role },
    emailSent,
    ...(emailSent ? {} : { tempPassword: password }),
  };
}

/**
 * Remember whether the member's latest invitation / password email went out (R-049), so
 * the Team page can say so and offer "Resend invite". A failure is also audited.
 */
export async function recordEmailOutcome(userId: string, sent: boolean, actor: Actor, what: string, ip: string | null) {
  await prisma.user.update({ where: { id: userId }, data: { inviteEmailFailedAt: sent ? null : new Date() } });
  if (!sent) {
    await audit({ actor, action: "user.email_failed", targetType: "user", targetId: userId, summary: `Couldn't send the ${what}`, ip });
    console.error(JSON.stringify({ level: "warn", at: new Date().toISOString(), kind: "email_failed", userId, what: what.split(" to ")[0] }));
  }
  invalidateTags("users");
}

/**
 * Deactivate a member: blocks sign-in, ends every session and pending reset code, and
 * stops a running timer (same rule as any other stop). Used by the Administrator and by
 * holders of users.deactivate.
 */
export async function deactivateMember(actor: SessionUser, targetId: string, ip: string | null) {
  await prisma.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: targetId }, include: { role: true } });
    if (!target || target.deletedAt) throw new ApiError(404, "Member not found.");
    if (target.id === actor.id) throw new ApiError(400, "You can't deactivate your own account.");
    if (isAdminRow(target)) throw new ApiError(403, "The Administrator account can't be deactivated.");
    if (!target.isActive) return;
    await tx.user.update({ where: { id: targetId }, data: { isActive: false, tokenVersion: { increment: 1 } } });
    await revokeCredentialsTx(tx, targetId);
    await stopRunningTimerTx(tx, targetId);
    await audit({ actor, action: "user.deactivate", targetType: "user", targetId, summary: `Deactivated ${target.name} (${target.email})`, ip }, tx);
  });
  invalidateTags("users");
  invalidateEntries(targetId);
}

/** Placeholder email for a deleted account: unique, never deliverable, frees the real address. */
export const deletedEmailFor = (id: string) => `deleted-${id}@deleted.invalid`;

/**
 * Delete a member (Administrator only, D-011): a soft delete. The account can't sign in, every
 * session and reset code ends, a running timer stops, project memberships go, and the member
 * disappears from Team and every picker. Their time entries stay, attributed to them. The real
 * email is parked in `deletedEmail` so the address can be invited again.
 */
export async function deleteMember(actor: SessionUser, targetId: string, ip: string | null) {
  await prisma.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: targetId }, include: { role: true } });
    if (!target || target.deletedAt) throw new ApiError(404, "Member not found.");
    if (target.id === actor.id) throw new ApiError(400, "You can't delete your own account.");
    if (isAdminRow(target)) throw new ApiError(403, "The Administrator account can't be deleted.");
    await tx.user.update({
      where: { id: targetId },
      data: {
        deletedAt: new Date(),
        deletedEmail: target.email,
        email: deletedEmailFor(target.id),
        isActive: false,
        inviteEmailFailedAt: null,
        tokenVersion: { increment: 1 },
      },
    });
    await revokeCredentialsTx(tx, targetId);
    await stopRunningTimerTx(tx, targetId);
    await tx.projectMember.deleteMany({ where: { userId: targetId } });
    await audit({ actor, action: "user.delete", targetType: "user", targetId, summary: `Deleted ${target.name} (${target.email}); their time entries were kept`, ip }, tx);
  });
  invalidateTags("users", "projects");
  invalidateEntries(targetId);
}

/** Undo a delete (Administrator only). The member comes back deactivated; reactivate separately. */
export async function restoreMember(actor: SessionUser, targetId: string, ip: string | null) {
  await prisma.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: targetId } });
    if (!target || !target.deletedAt || !target.deletedEmail) throw new ApiError(404, "Deleted member not found.");
    const taken = await tx.user.findUnique({ where: { email: target.deletedEmail }, select: { id: true } });
    if (taken) throw new ApiError(409, `${target.deletedEmail} now belongs to another member, so ${target.name} can't be restored with it.`);
    await tx.user.update({ where: { id: targetId }, data: { deletedAt: null, deletedEmail: null, email: target.deletedEmail, isActive: false } });
    await audit({ actor, action: "user.restore", targetType: "user", targetId, summary: `Restored ${target.name} (${target.deletedEmail}) as deactivated`, ip }, tx);
  });
  invalidateTags("users");
  invalidateEntries(targetId);
}
