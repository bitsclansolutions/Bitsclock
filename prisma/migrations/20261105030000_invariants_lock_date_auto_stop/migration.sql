-- D-006 (database enforces core invariants) and D-005 (auto-stop flag, workspace lock date).
-- Hand-written: Prisma's generated version dropped and re-added the kind/memberMode
-- columns, which would have reset every project to the default.

-- 1. Check existing rows against the new rules first, and stop with a readable message
--    instead of a constraint error halfway through.
DO $$
DECLARE
  bad_range INTEGER;
  multi_running INTEGER;
  bad_kind INTEGER;
  bad_mode INTEGER;
BEGIN
  SELECT COUNT(*) INTO bad_range FROM "bc_time_entries" WHERE "endTime" IS NOT NULL AND "endTime" <= "startTime";
  SELECT COUNT(*) INTO multi_running FROM (
    SELECT "userId" FROM "bc_time_entries" WHERE "endTime" IS NULL GROUP BY "userId" HAVING COUNT(*) > 1
  ) t;
  SELECT COUNT(*) INTO bad_kind FROM "bc_projects" WHERE "kind" NOT IN ('project', 'activity');
  SELECT COUNT(*) INTO bad_mode FROM "bc_projects" WHERE "memberMode" NOT IN ('all', 'selected');
  IF bad_range + multi_running + bad_kind + bad_mode > 0 THEN
    RAISE EXCEPTION 'Fix these rows before migrating: % entries with end <= start, % users with more than one running timer, % projects with an unknown kind, % projects with an unknown memberMode',
      bad_range, multi_running, bad_kind, bad_mode;
  END IF;
END $$;

-- 2. kind and memberMode become enums, converting the existing values in place.
CREATE TYPE "MemberMode" AS ENUM ('all', 'selected');
CREATE TYPE "ProjectKind" AS ENUM ('project', 'activity');

ALTER TABLE "bc_projects" ALTER COLUMN "memberMode" DROP DEFAULT;
ALTER TABLE "bc_projects" ALTER COLUMN "memberMode" TYPE "MemberMode" USING "memberMode"::"MemberMode";
ALTER TABLE "bc_projects" ALTER COLUMN "memberMode" SET DEFAULT 'all';

ALTER TABLE "bc_projects" ALTER COLUMN "kind" DROP DEFAULT;
ALTER TABLE "bc_projects" ALTER COLUMN "kind" TYPE "ProjectKind" USING "kind"::"ProjectKind";
ALTER TABLE "bc_projects" ALTER COLUMN "kind" SET DEFAULT 'project';

-- 3. Deleting a member or a project can no longer delete (or orphan) time history.
ALTER TABLE "bc_time_entries" DROP CONSTRAINT "bc_time_entries_userId_fkey";
ALTER TABLE "bc_time_entries" ADD CONSTRAINT "bc_time_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "bc_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bc_time_entries" DROP CONSTRAINT "bc_time_entries_projectId_fkey";
ALTER TABLE "bc_time_entries" ADD CONSTRAINT "bc_time_entries_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "bc_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. An entry ends after it starts.
ALTER TABLE "bc_time_entries" ADD CONSTRAINT "bc_time_entries_end_after_start" CHECK ("endTime" IS NULL OR "endTime" > "startTime");

-- 5. At most one running timer per member. Also serves the "running timer" lookup (M20).
CREATE UNIQUE INDEX "bc_time_entries_one_running_per_user" ON "bc_time_entries"("userId") WHERE "endTime" IS NULL;

-- 6. D-005: entries closed automatically at start + 24 h are flagged for the member to check.
ALTER TABLE "bc_time_entries" ADD COLUMN "autoStopped" BOOLEAN NOT NULL DEFAULT false;

-- 7. D-005: workspace settings (single row) with the invoicing lock date.
CREATE TABLE "bc_workspace_settings" (
    "id" TEXT NOT NULL DEFAULT 'workspace',
    "lockDate" TIMESTAMP(3),
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bc_workspace_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "bc_workspace_settings_single_row" CHECK ("id" = 'workspace')
);
