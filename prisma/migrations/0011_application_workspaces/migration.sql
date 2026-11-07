CREATE TYPE "WorkspaceCode" AS ENUM ('POS','CALL_CENTER','KITCHEN','DISPATCH','HR','ACCOUNTING','INVENTORY','MANAGEMENT');
ALTER TABLE "Session" ADD COLUMN "workspace" "WorkspaceCode" NOT NULL DEFAULT 'POS';
CREATE INDEX "Session_workspace_revokedAt_idx" ON "Session"("workspace","revokedAt");
