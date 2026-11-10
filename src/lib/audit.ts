import { prisma, type Prisma, type Tx } from "./prisma";

type Db = Pick<Tx, "auditLog">;

export type AuditAction =
  | "user.create"
  | "user.update"
  | "user.role_change"
  | "user.deactivate"
  | "user.reactivate"
  | "user.delete"
  | "user.restore"
  | "user.password_reset"
  | "user.email_failed"
  | "role.create"
  | "role.update"
  | "role.delete"
  | "member_request.create"
  | "member_request.approve"
  | "member_request.reject"
  | "workspace.lock_date"
  | "workspace.time_zone"
  | "admin.recover";

export type AuditEntry = {
  actor: { id: string; name: string } | null;
  action: AuditAction;
  targetType: "user" | "role" | "member_request" | "workspace";
  targetId?: string | null;
  summary: string;
  meta?: Prisma.InputJsonValue;
  ip?: string | null;
};

/**
 * Append one row to the audit log. Pass the transaction client when the action itself
 * runs in a transaction, so the record and the change commit (or roll back) together.
 */
export async function audit(entry: AuditEntry, db: Db = prisma) {
  await db.auditLog.create({
    data: {
      actorId: entry.actor?.id ?? null,
      actorName: entry.actor?.name ?? "System",
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId ?? null,
      summary: entry.summary.slice(0, 500),
      meta: entry.meta,
      ip: entry.ip?.slice(0, 64) ?? null,
    },
  });
}
