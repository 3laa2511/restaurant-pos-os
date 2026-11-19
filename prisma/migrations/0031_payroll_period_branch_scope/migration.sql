ALTER TABLE "PayrollPeriod"
ADD COLUMN "branchId" TEXT;

ALTER TABLE "PayrollPeriod"
DROP CONSTRAINT IF EXISTS "PayrollPeriod_tenantId_periodStart_periodEnd_key";

DROP INDEX IF EXISTS "PayrollPeriod_tenantId_periodStart_periodEnd_key";

ALTER TABLE "PayrollPeriod"
ADD CONSTRAINT "PayrollPeriod_branchId_fkey"
FOREIGN KEY ("branchId") REFERENCES "Branch"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- One payroll period per tenant/branch/date range. PostgreSQL's normal unique
-- semantics treat NULL values as distinct, so the tenant-wide case has its own
-- partial unique index.
CREATE UNIQUE INDEX "PayrollPeriod_branch_period_unique"
ON "PayrollPeriod"("tenantId", "branchId", "periodStart", "periodEnd")
WHERE "branchId" IS NOT NULL;

CREATE UNIQUE INDEX "PayrollPeriod_tenant_global_period_unique"
ON "PayrollPeriod"("tenantId", "periodStart", "periodEnd")
WHERE "branchId" IS NULL;

CREATE INDEX "PayrollPeriod_tenantId_branchId_status_periodStart_idx"
ON "PayrollPeriod"("tenantId", "branchId", "status", "periodStart");
