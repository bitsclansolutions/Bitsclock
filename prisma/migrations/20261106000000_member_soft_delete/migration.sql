-- Soft-deleted members (D-011): additive only, existing rows are untouched.
ALTER TABLE "bc_users" ADD COLUMN "deletedAt" TIMESTAMP(3),
ADD COLUMN "deletedEmail" TEXT;
