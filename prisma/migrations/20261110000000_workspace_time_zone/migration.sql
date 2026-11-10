-- Workspace time zone (D-012): every member sees and enters time in this zone.
ALTER TABLE "bc_workspace_settings" ADD COLUMN "timeZone" TEXT NOT NULL DEFAULT 'Asia/Karachi';
