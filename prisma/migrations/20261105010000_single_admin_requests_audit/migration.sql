-- CreateTable
CREATE TABLE "bc_member_requests" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "jobTitle" TEXT,
    "roleId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "note" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bc_member_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bc_audit_log" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "summary" TEXT NOT NULL,
    "meta" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bc_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bc_member_requests_status_createdAt_idx" ON "bc_member_requests"("status", "createdAt");

-- CreateIndex
CREATE INDEX "bc_member_requests_requestedById_idx" ON "bc_member_requests"("requestedById");

-- CreateIndex
CREATE INDEX "bc_audit_log_createdAt_idx" ON "bc_audit_log"("createdAt");

-- CreateIndex
CREATE INDEX "bc_audit_log_targetType_targetId_idx" ON "bc_audit_log"("targetType", "targetId");

-- AddForeignKey
ALTER TABLE "bc_member_requests" ADD CONSTRAINT "bc_member_requests_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bc_member_requests" ADD CONSTRAINT "bc_member_requests_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "bc_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written (Prisma can't express these):

-- A request is pending, approved or rejected.
ALTER TABLE "bc_member_requests" ADD CONSTRAINT "bc_member_requests_status_check" CHECK ("status" IN ('pending', 'approved', 'rejected'));

-- At most one pending request per email address.
CREATE UNIQUE INDEX "bc_member_requests_one_pending_per_email" ON "bc_member_requests"("email") WHERE "status" = 'pending';

-- D-001: managing members and roles is Administrator-only. Strip those permissions from
-- every other role (they were grantable before; whoever held them could become admin).
DELETE FROM "role_permissions"
WHERE "permission" IN ('users.manage', 'roles.manage')
  AND "roleId" NOT IN (SELECT "id" FROM "roles" WHERE "name" = 'Administrator');

