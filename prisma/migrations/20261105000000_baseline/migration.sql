-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT '#0d9488',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "roleId" TEXT NOT NULL,
    "permission" TEXT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleId","permission")
);

-- CreateTable
CREATE TABLE "bc_users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "jobTitle" TEXT,
    "roleId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bc_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bc_refresh_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "prevTokenHash" TEXT,
    "rotatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "remember" BOOLEAN NOT NULL DEFAULT false,
    "userAgent" TEXT,
    "ip" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bc_refresh_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bc_password_resets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bc_password_resets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bc_idempotency_keys" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 0,
    "body" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bc_idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bc_projects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT '#0d9488',
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "memberMode" TEXT NOT NULL DEFAULT 'all',
    "kind" TEXT NOT NULL DEFAULT 'project',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bc_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bc_project_members" (
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bc_project_members_pkey" PRIMARY KEY ("projectId","userId")
);

-- CreateTable
CREATE TABLE "bc_time_entries" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3),
    "durationSeconds" INTEGER,
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bc_time_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "bc_users_email_key" ON "bc_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "bc_refresh_sessions_tokenHash_key" ON "bc_refresh_sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "bc_refresh_sessions_userId_idx" ON "bc_refresh_sessions"("userId");

-- CreateIndex
CREATE INDEX "bc_refresh_sessions_prevTokenHash_idx" ON "bc_refresh_sessions"("prevTokenHash");

-- CreateIndex
CREATE INDEX "bc_password_resets_userId_createdAt_idx" ON "bc_password_resets"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "bc_idempotency_keys_createdAt_idx" ON "bc_idempotency_keys"("createdAt");

-- CreateIndex
CREATE INDEX "bc_project_members_userId_idx" ON "bc_project_members"("userId");

-- CreateIndex
CREATE INDEX "bc_time_entries_userId_startTime_idx" ON "bc_time_entries"("userId", "startTime");

-- CreateIndex
CREATE INDEX "bc_time_entries_projectId_startTime_idx" ON "bc_time_entries"("projectId", "startTime");

-- CreateIndex
CREATE INDEX "bc_time_entries_userId_endTime_idx" ON "bc_time_entries"("userId", "endTime");

-- CreateIndex
CREATE INDEX "bc_time_entries_startTime_idx" ON "bc_time_entries"("startTime");

-- CreateIndex
CREATE INDEX "bc_time_entries_userId_projectId_idx" ON "bc_time_entries"("userId", "projectId");

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bc_users" ADD CONSTRAINT "bc_users_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bc_refresh_sessions" ADD CONSTRAINT "bc_refresh_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "bc_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bc_password_resets" ADD CONSTRAINT "bc_password_resets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "bc_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bc_projects" ADD CONSTRAINT "bc_projects_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "bc_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bc_project_members" ADD CONSTRAINT "bc_project_members_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "bc_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bc_project_members" ADD CONSTRAINT "bc_project_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "bc_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bc_time_entries" ADD CONSTRAINT "bc_time_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "bc_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bc_time_entries" ADD CONSTRAINT "bc_time_entries_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "bc_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

