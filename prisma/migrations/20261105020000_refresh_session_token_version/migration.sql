-- AlterTable
ALTER TABLE "bc_refresh_sessions" ADD COLUMN     "tokenVersion" INTEGER NOT NULL DEFAULT 0;

-- Hand-written: existing live sessions belong to the user's current version, so nobody is
-- signed out by this migration. Sessions from before a password change were already revoked.
UPDATE "bc_refresh_sessions" s
SET "tokenVersion" = u."tokenVersion"
FROM "bc_users" u
WHERE u."id" = s."userId";

