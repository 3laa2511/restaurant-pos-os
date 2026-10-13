-- Enterprise operating foundation for the restaurant application.
-- Adds explicit central/branch warehouse topology and department scope.
-- No business/company names are seeded here.

CREATE TYPE "WarehouseType" AS ENUM ('CENTRAL','BRANCH');

CREATE TABLE "Warehouse" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "branchId" TEXT,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "nameAr" TEXT,
  "type" "WarehouseType" NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Warehouse_tenantId_code_key"
  ON "Warehouse"("tenantId","code");
CREATE UNIQUE INDEX "Warehouse_tenantId_central_key"
  ON "Warehouse"("tenantId")
  WHERE "type" = 'CENTRAL';
CREATE UNIQUE INDEX "Warehouse_branchId_key"
  ON "Warehouse"("branchId")
  WHERE "branchId" IS NOT NULL;
CREATE INDEX "Warehouse_tenantId_type_active_idx"
  ON "Warehouse"("tenantId","type","active");

ALTER TABLE "Warehouse"
  ADD CONSTRAINT "Warehouse_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Warehouse"
  ADD CONSTRAINT "Warehouse_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "WarehouseStockBalance" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "ingredientId" TEXT NOT NULL,
  "quantityBaseUnit" DECIMAL(14,4) NOT NULL DEFAULT 0,
  "averageCostPerBaseUnit" DECIMAL(14,6) NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WarehouseStockBalance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WarehouseStockBalance_warehouseId_ingredientId_key"
  ON "WarehouseStockBalance"("warehouseId","ingredientId");
CREATE INDEX "WarehouseStockBalance_tenantId_warehouseId_idx"
  ON "WarehouseStockBalance"("tenantId","warehouseId");

ALTER TABLE "WarehouseStockBalance"
  ADD CONSTRAINT "WarehouseStockBalance_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarehouseStockBalance"
  ADD CONSTRAINT "WarehouseStockBalance_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarehouseStockBalance"
  ADD CONSTRAINT "WarehouseStockBalance_ingredientId_fkey"
  FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "InventoryTransfer" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "transferNumber" TEXT NOT NULL,
  "fromWarehouseId" TEXT NOT NULL,
  "toWarehouseId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "requestedById" TEXT,
  "approvedById" TEXT,
  "requestedAt" TIMESTAMP(3),
  "approvedAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "receivedAt" TIMESTAMP(3),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InventoryTransfer_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InventoryTransfer_status_check"
    CHECK ("status" IN ('DRAFT','REQUESTED','APPROVED','IN_TRANSIT','RECEIVED','CANCELLED')),
  CONSTRAINT "InventoryTransfer_different_warehouses_check"
    CHECK ("fromWarehouseId" <> "toWarehouseId")
);

CREATE UNIQUE INDEX "InventoryTransfer_tenantId_transferNumber_key"
  ON "InventoryTransfer"("tenantId","transferNumber");
CREATE INDEX "InventoryTransfer_tenantId_status_createdAt_idx"
  ON "InventoryTransfer"("tenantId","status","createdAt");

ALTER TABLE "InventoryTransfer"
  ADD CONSTRAINT "InventoryTransfer_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryTransfer"
  ADD CONSTRAINT "InventoryTransfer_fromWarehouseId_fkey"
  FOREIGN KEY ("fromWarehouseId") REFERENCES "Warehouse"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryTransfer"
  ADD CONSTRAINT "InventoryTransfer_toWarehouseId_fkey"
  FOREIGN KEY ("toWarehouseId") REFERENCES "Warehouse"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryTransfer"
  ADD CONSTRAINT "InventoryTransfer_requestedById_fkey"
  FOREIGN KEY ("requestedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InventoryTransfer"
  ADD CONSTRAINT "InventoryTransfer_approvedById_fkey"
  FOREIGN KEY ("approvedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "InventoryTransferItem" (
  "id" TEXT NOT NULL,
  "transferId" TEXT NOT NULL,
  "ingredientId" TEXT NOT NULL,
  "quantityBaseUnit" DECIMAL(14,4) NOT NULL,
  "unitCost" DECIMAL(12,6) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryTransferItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InventoryTransferItem_quantity_check" CHECK ("quantityBaseUnit" > 0)
);

CREATE INDEX "InventoryTransferItem_transferId_idx"
  ON "InventoryTransferItem"("transferId");
CREATE INDEX "InventoryTransferItem_ingredientId_idx"
  ON "InventoryTransferItem"("ingredientId");

ALTER TABLE "InventoryTransferItem"
  ADD CONSTRAINT "InventoryTransferItem_transferId_fkey"
  FOREIGN KEY ("transferId") REFERENCES "InventoryTransfer"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryTransferItem"
  ADD CONSTRAINT "InventoryTransferItem_ingredientId_fkey"
  FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "Department" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "branchId" TEXT,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "nameAr" TEXT,
  "central" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Department_tenantId_code_key"
  ON "Department"("tenantId","code");
CREATE INDEX "Department_tenantId_branchId_active_idx"
  ON "Department"("tenantId","branchId","active");

ALTER TABLE "Department"
  ADD CONSTRAINT "Department_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Department"
  ADD CONSTRAINT "Department_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "User" ADD COLUMN "departmentId" TEXT;
ALTER TABLE "User"
  ADD CONSTRAINT "User_departmentId_fkey"
  FOREIGN KEY ("departmentId") REFERENCES "Department"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "User_tenantId_departmentId_idx"
  ON "User"("tenantId","departmentId");

-- Defense-in-depth checks for tenant boundaries on the new graph.
CREATE OR REPLACE FUNCTION "enforce_enterprise_tenant_consistency"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  expected_tenant TEXT;
BEGIN
  IF TG_TABLE_NAME = 'Warehouse' AND NEW."branchId" IS NOT NULL THEN
    SELECT "tenantId" INTO expected_tenant FROM "Branch" WHERE "id" = NEW."branchId";
    IF expected_tenant IS NULL OR expected_tenant <> NEW."tenantId" THEN
      RAISE EXCEPTION 'TENANT_BRANCH_MISMATCH';
    END IF;
    IF NEW."type" = 'CENTRAL' THEN
      RAISE EXCEPTION 'CENTRAL_WAREHOUSE_CANNOT_BE_BRANCH_BOUND';
    END IF;
  ELSIF TG_TABLE_NAME = 'Warehouse' AND NEW."branchId" IS NULL THEN
    IF NEW."type" <> 'CENTRAL' THEN
      RAISE EXCEPTION 'BRANCH_WAREHOUSE_REQUIRES_BRANCH';
    END IF;
  ELSIF TG_TABLE_NAME = 'WarehouseStockBalance' THEN
    SELECT "tenantId" INTO expected_tenant FROM "Warehouse" WHERE "id" = NEW."warehouseId";
    IF expected_tenant IS NULL OR expected_tenant <> NEW."tenantId" THEN
      RAISE EXCEPTION 'TENANT_WAREHOUSE_MISMATCH';
    END IF;
  ELSIF TG_TABLE_NAME = 'InventoryTransfer' THEN
    SELECT "tenantId" INTO expected_tenant FROM "Warehouse" WHERE "id" = NEW."fromWarehouseId";
    IF expected_tenant IS NULL OR expected_tenant <> NEW."tenantId" THEN
      RAISE EXCEPTION 'TENANT_SOURCE_WAREHOUSE_MISMATCH';
    END IF;
    SELECT "tenantId" INTO expected_tenant FROM "Warehouse" WHERE "id" = NEW."toWarehouseId";
    IF expected_tenant IS NULL OR expected_tenant <> NEW."tenantId" THEN
      RAISE EXCEPTION 'TENANT_TARGET_WAREHOUSE_MISMATCH';
    END IF;
  ELSIF TG_TABLE_NAME = 'InventoryTransferItem' THEN
    SELECT i."tenantId" INTO expected_tenant
    FROM "Ingredient" i
    WHERE i."id" = NEW."ingredientId";
    IF expected_tenant IS NULL OR expected_tenant <> (
      SELECT t."tenantId" FROM "InventoryTransfer" t WHERE t."id" = NEW."transferId"
    ) THEN
      RAISE EXCEPTION 'TENANT_TRANSFER_INGREDIENT_MISMATCH';
    END IF;
  ELSIF TG_TABLE_NAME = 'Department' AND NEW."branchId" IS NOT NULL THEN
    SELECT "tenantId" INTO expected_tenant FROM "Branch" WHERE "id" = NEW."branchId";
    IF expected_tenant IS NULL OR expected_tenant <> NEW."tenantId" THEN
      RAISE EXCEPTION 'TENANT_DEPARTMENT_BRANCH_MISMATCH';
    END IF;
    IF NEW."central" = true THEN
      RAISE EXCEPTION 'CENTRAL_DEPARTMENT_CANNOT_BE_BRANCH_BOUND';
    END IF;
  ELSIF TG_TABLE_NAME = 'Department' AND NEW."branchId" IS NULL THEN
    IF NEW."central" <> true THEN
      RAISE EXCEPTION 'BRANCH_DEPARTMENT_REQUIRES_BRANCH';
    END IF;
  ELSIF TG_TABLE_NAME = 'User' AND NEW."departmentId" IS NOT NULL THEN
    SELECT "tenantId" INTO expected_tenant FROM "Department" WHERE "id" = NEW."departmentId";
    IF expected_tenant IS NULL OR expected_tenant <> NEW."tenantId" THEN
      RAISE EXCEPTION 'TENANT_USER_DEPARTMENT_MISMATCH';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Warehouse_tenant_consistency"
BEFORE INSERT OR UPDATE OF "tenantId","branchId","type"
ON "Warehouse" FOR EACH ROW EXECUTE FUNCTION "enforce_enterprise_tenant_consistency"();

CREATE TRIGGER "WarehouseStockBalance_tenant_consistency"
BEFORE INSERT OR UPDATE OF "tenantId","warehouseId"
ON "WarehouseStockBalance" FOR EACH ROW EXECUTE FUNCTION "enforce_enterprise_tenant_consistency"();

CREATE TRIGGER "InventoryTransfer_tenant_consistency"
BEFORE INSERT OR UPDATE OF "tenantId","fromWarehouseId","toWarehouseId"
ON "InventoryTransfer" FOR EACH ROW EXECUTE FUNCTION "enforce_enterprise_tenant_consistency"();

CREATE TRIGGER "InventoryTransferItem_tenant_consistency"
BEFORE INSERT OR UPDATE OF "transferId","ingredientId"
ON "InventoryTransferItem" FOR EACH ROW EXECUTE FUNCTION "enforce_enterprise_tenant_consistency"();

CREATE TRIGGER "Department_tenant_consistency"
BEFORE INSERT OR UPDATE OF "tenantId","branchId","central"
ON "Department" FOR EACH ROW EXECUTE FUNCTION "enforce_enterprise_tenant_consistency"();

CREATE TRIGGER "User_department_tenant_consistency"
BEFORE INSERT OR UPDATE OF "tenantId","departmentId"
ON "User" FOR EACH ROW EXECUTE FUNCTION "enforce_enterprise_tenant_consistency"();
