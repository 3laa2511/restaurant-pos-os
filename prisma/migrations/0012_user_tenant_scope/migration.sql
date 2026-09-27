ALTER TABLE "User" ADD COLUMN "tenantId" TEXT;

UPDATE "User" u
SET "tenantId" = b."tenantId"
FROM "Branch" b
WHERE u."branchId" = b."id"
  AND u."tenantId" IS NULL;

UPDATE "User"
SET "tenantId" = 'legacy-tenant'
WHERE "tenantId" IS NULL;

ALTER TABLE "User" ALTER COLUMN "tenantId" SET NOT NULL;

ALTER TABLE "User"
  ADD CONSTRAINT "User_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "User_tenantId_status_idx" ON "User"("tenantId","status");
