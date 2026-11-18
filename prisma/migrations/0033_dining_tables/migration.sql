-- Dining areas and tables are scoped to both tenant and branch.
CREATE TYPE "DiningTableStatus" AS ENUM (
  'AVAILABLE',
  'OCCUPIED',
  'RESERVED',
  'CLEANING',
  'OUT_OF_SERVICE'
);

CREATE TABLE "DiningArea" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "nameAr" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DiningArea_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DiningArea_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DiningArea_branch_tenant_fkey"
    FOREIGN KEY ("branchId", "tenantId") REFERENCES "Branch"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DiningArea_name_check" CHECK (length(btrim("name")) > 0)
);

CREATE UNIQUE INDEX "DiningArea_id_branchId_tenantId_key"
  ON "DiningArea"("id", "branchId", "tenantId");
CREATE UNIQUE INDEX "DiningArea_branchId_name_key"
  ON "DiningArea"("branchId", "name");
CREATE INDEX "DiningArea_tenantId_branchId_active_sortOrder_idx"
  ON "DiningArea"("tenantId", "branchId", "active", "sortOrder");

CREATE TABLE "DiningTable" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "areaId" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "name" TEXT,
  "nameAr" TEXT,
  "seats" INTEGER NOT NULL,
  "status" "DiningTableStatus" NOT NULL DEFAULT 'AVAILABLE',
  "currentOrderId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DiningTable_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DiningTable_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DiningTable_branch_tenant_fkey"
    FOREIGN KEY ("branchId", "tenantId") REFERENCES "Branch"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DiningTable_area_branch_tenant_fkey"
    FOREIGN KEY ("areaId", "branchId", "tenantId")
    REFERENCES "DiningArea"("id", "branchId", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DiningTable_currentOrder_branch_fkey"
    FOREIGN KEY ("currentOrderId", "branchId")
    REFERENCES "Order"("id", "branchId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DiningTable_seats_check" CHECK ("seats" > 0 AND "seats" <= 100),
  CONSTRAINT "DiningTable_number_check" CHECK (length(btrim("number")) > 0)
);

CREATE UNIQUE INDEX "DiningTable_areaId_number_key"
  ON "DiningTable"("areaId", "number");
CREATE UNIQUE INDEX "DiningTable_currentOrderId_branchId_key"
  ON "DiningTable"("currentOrderId", "branchId");
CREATE INDEX "DiningTable_tenantId_branchId_status_idx"
  ON "DiningTable"("tenantId", "branchId", "status");
CREATE INDEX "DiningTable_areaId_status_idx"
  ON "DiningTable"("areaId", "status");

ALTER TABLE "DiningArea" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DiningArea" FORCE ROW LEVEL SECURITY;
CREATE POLICY dining_area_tenant_branch_scope ON "DiningArea"
  USING (app.tenant_visible("tenantId") AND app.branch_visible("branchId"))
  WITH CHECK (app.tenant_visible("tenantId") AND app.branch_visible("branchId"));

ALTER TABLE "DiningTable" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DiningTable" FORCE ROW LEVEL SECURITY;
CREATE POLICY dining_table_tenant_branch_scope ON "DiningTable"
  USING (app.tenant_visible("tenantId") AND app.branch_visible("branchId"))
  WITH CHECK (app.tenant_visible("tenantId") AND app.branch_visible("branchId"));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'DiningArea'
      AND policyname = 'dining_area_tenant_branch_scope'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'DiningTable'
      AND policyname = 'dining_table_tenant_branch_scope'
  ) THEN
    RAISE EXCEPTION 'Dining area/table RLS policies are required';
  END IF;
END $$;
