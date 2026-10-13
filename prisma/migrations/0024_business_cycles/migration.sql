CREATE TABLE "BusinessCycle" (
  "id" text NOT NULL,
  "tenantId" text NOT NULL,
  "branchId" text NOT NULL,
  "name" text NOT NULL,
  "status" text NOT NULL DEFAULT 'OPEN',
  "openedById" text NOT NULL,
  "closedById" text,
  "openedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" timestamp(3),
  "closeSummary" jsonb,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL,
  CONSTRAINT "BusinessCycle_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Order" ADD COLUMN "cycleId" text;

CREATE INDEX "BusinessCycle_tenantId_branchId_status_idx" ON "BusinessCycle"("tenantId","branchId","status");
CREATE INDEX "BusinessCycle_tenantId_branchId_openedAt_idx" ON "BusinessCycle"("tenantId","branchId","openedAt");
CREATE UNIQUE INDEX "BusinessCycle_one_open_per_branch" ON "BusinessCycle"("tenantId","branchId") WHERE "status" = 'OPEN';
CREATE INDEX "Order_cycleId_idx" ON "Order"("cycleId");

ALTER TABLE "BusinessCycle" ADD CONSTRAINT "BusinessCycle_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BusinessCycle" ADD CONSTRAINT "BusinessCycle_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BusinessCycle" ADD CONSTRAINT "BusinessCycle_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BusinessCycle" ADD CONSTRAINT "BusinessCycle_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "BusinessCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BusinessCycle" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BusinessCycle" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "BusinessCycle";
CREATE POLICY tenant_isolation ON "BusinessCycle"
  USING (app.tenant_visible("tenantId") AND app.branch_visible("branchId"))
  WITH CHECK (app.tenant_visible("tenantId") AND app.branch_visible("branchId"));
