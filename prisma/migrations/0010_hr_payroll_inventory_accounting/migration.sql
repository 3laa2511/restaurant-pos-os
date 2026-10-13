ALTER TYPE "RoleCode" ADD VALUE IF NOT EXISTS 'HR_MANAGER';
ALTER TYPE "RoleCode" ADD VALUE IF NOT EXISTS 'ACCOUNTANT';
ALTER TYPE "RoleCode" ADD VALUE IF NOT EXISTS 'INVENTORY_MANAGER';

CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT','LATE','ABSENT','LEAVE','OFF_DAY');
CREATE TYPE "PayrollStatus" AS ENUM ('DRAFT','APPROVED','PAID','CANCELLED');
CREATE TYPE "InventoryUnit" AS ENUM ('GRAM','KILOGRAM','BAG','MILLILITER','LITER','PIECE','BOX','PACK');
CREATE TYPE "InventoryMovementType" AS ENUM ('PURCHASE','CONSUMPTION','WASTE','ADJUSTMENT_IN','ADJUSTMENT_OUT','TRANSFER_IN','TRANSFER_OUT');

CREATE TABLE "EmployeeProfile" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "employeeCode" TEXT NOT NULL,
  "jobTitle" TEXT NOT NULL,
  "phone" TEXT,
  "nationalIdLast4" TEXT,
  "hireDate" TIMESTAMP(3),
  "terminationDate" TIMESTAMP(3),
  "baseSalary" DECIMAL(12,2) NOT NULL,
  "overtimeRate" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmployeeProfile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EmployeeProfile_userId_key" ON "EmployeeProfile"("userId");
CREATE UNIQUE INDEX "EmployeeProfile_tenantId_employeeCode_key" ON "EmployeeProfile"("tenantId","employeeCode");
CREATE INDEX "EmployeeProfile_tenantId_active_idx" ON "EmployeeProfile"("tenantId","active");
ALTER TABLE "EmployeeProfile" ADD CONSTRAINT "EmployeeProfile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmployeeProfile" ADD CONSTRAINT "EmployeeProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "WorkSchedule" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "userId" TEXT NOT NULL, "branchId" TEXT,
  "weekday" INTEGER NOT NULL, "startMinute" INTEGER NOT NULL, "endMinute" INTEGER NOT NULL,
  "breakMinutes" INTEGER NOT NULL DEFAULT 0, "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveTo" TIMESTAMP(3), "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "WorkSchedule_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WorkSchedule_tenantId_userId_weekday_active_idx" ON "WorkSchedule"("tenantId","userId","weekday","active");
CREATE INDEX "WorkSchedule_branchId_weekday_active_idx" ON "WorkSchedule"("branchId","weekday","active");
ALTER TABLE "WorkSchedule" ADD CONSTRAINT "WorkSchedule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkSchedule" ADD CONSTRAINT "WorkSchedule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkSchedule" ADD CONSTRAINT "WorkSchedule_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "AttendanceRecord" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "userId" TEXT NOT NULL, "branchId" TEXT NOT NULL,
  "workDate" TIMESTAMP(3) NOT NULL, "status" "AttendanceStatus" NOT NULL DEFAULT 'PRESENT',
  "scheduledStartMinute" INTEGER, "scheduledEndMinute" INTEGER, "checkInAt" TIMESTAMP(3), "checkOutAt" TIMESTAMP(3),
  "workedMinutes" INTEGER NOT NULL DEFAULT 0, "overtimeMinutes" INTEGER NOT NULL DEFAULT 0,
  "lateMinutes" INTEGER NOT NULL DEFAULT 0, "notes" TEXT, "approvedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AttendanceRecord_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AttendanceRecord_userId_workDate_key" ON "AttendanceRecord"("userId","workDate");
CREATE INDEX "AttendanceRecord_tenantId_workDate_status_idx" ON "AttendanceRecord"("tenantId","workDate","status");
CREATE INDEX "AttendanceRecord_branchId_workDate_idx" ON "AttendanceRecord"("branchId","workDate");
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PayrollPeriod" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "name" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL, "periodEnd" TIMESTAMP(3) NOT NULL,
  "status" "PayrollStatus" NOT NULL DEFAULT 'DRAFT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PayrollPeriod_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PayrollPeriod_tenantId_periodStart_periodEnd_key" ON "PayrollPeriod"("tenantId","periodStart","periodEnd");
CREATE INDEX "PayrollPeriod_tenantId_status_periodStart_idx" ON "PayrollPeriod"("tenantId","status","periodStart");
ALTER TABLE "PayrollPeriod" ADD CONSTRAINT "PayrollPeriod_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PayrollEntry" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "periodId" TEXT NOT NULL, "userId" TEXT NOT NULL,
  "baseSalary" DECIMAL(12,2) NOT NULL, "overtimeAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "bonuses" DECIMAL(12,2) NOT NULL DEFAULT 0, "deductions" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "netAmount" DECIMAL(12,2) NOT NULL, "paidAt" TIMESTAMP(3), "notes" TEXT,
  CONSTRAINT "PayrollEntry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PayrollEntry_periodId_userId_key" ON "PayrollEntry"("periodId","userId");
CREATE INDEX "PayrollEntry_tenantId_userId_idx" ON "PayrollEntry"("tenantId","userId");
ALTER TABLE "PayrollEntry" ADD CONSTRAINT "PayrollEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollEntry" ADD CONSTRAINT "PayrollEntry_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "PayrollPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayrollEntry" ADD CONSTRAINT "PayrollEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "Supplier" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "name" TEXT NOT NULL, "phone" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Supplier_tenantId_name_key" ON "Supplier"("tenantId","name");
CREATE INDEX "Supplier_tenantId_active_idx" ON "Supplier"("tenantId","active");
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "Ingredient" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "sku" TEXT NOT NULL, "name" TEXT NOT NULL, "nameAr" TEXT,
  "baseUnit" "InventoryUnit" NOT NULL, "purchaseUnit" "InventoryUnit" NOT NULL,
  "purchaseUnitFactor" DECIMAL(14,4) NOT NULL, "reorderLevel" DECIMAL(14,4) NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "Ingredient_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Ingredient_tenantId_sku_key" ON "Ingredient"("tenantId","sku");
CREATE INDEX "Ingredient_tenantId_active_idx" ON "Ingredient"("tenantId","active");
ALTER TABLE "Ingredient" ADD CONSTRAINT "Ingredient_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "InventoryStockBalance" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "branchId" TEXT NOT NULL, "ingredientId" TEXT NOT NULL,
  "quantityBaseUnit" DECIMAL(14,4) NOT NULL DEFAULT 0, "averageCostPerBaseUnit" DECIMAL(14,6) NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "InventoryStockBalance_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InventoryStockBalance_branchId_ingredientId_key" ON "InventoryStockBalance"("branchId","ingredientId");
CREATE INDEX "InventoryStockBalance_tenantId_branchId_idx" ON "InventoryStockBalance"("tenantId","branchId");
ALTER TABLE "InventoryStockBalance" ADD CONSTRAINT "InventoryStockBalance_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryStockBalance" ADD CONSTRAINT "InventoryStockBalance_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryStockBalance" ADD CONSTRAINT "InventoryStockBalance_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "InventoryReceipt" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "branchId" TEXT NOT NULL, "supplierId" TEXT,
  "reference" TEXT, "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "totalCost" DECIMAL(12,2) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryReceipt_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "InventoryReceipt_tenantId_branchId_receivedAt_idx" ON "InventoryReceipt"("tenantId","branchId","receivedAt");
ALTER TABLE "InventoryReceipt" ADD CONSTRAINT "InventoryReceipt_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryReceipt" ADD CONSTRAINT "InventoryReceipt_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryReceipt" ADD CONSTRAINT "InventoryReceipt_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "InventoryReceiptItem" (
  "id" TEXT NOT NULL, "receiptId" TEXT NOT NULL, "ingredientId" TEXT NOT NULL,
  "quantityPurchaseUnit" DECIMAL(14,4) NOT NULL, "quantityBaseUnit" DECIMAL(14,4) NOT NULL,
  "unitCost" DECIMAL(12,4) NOT NULL, "totalCost" DECIMAL(12,2) NOT NULL,
  CONSTRAINT "InventoryReceiptItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "InventoryReceiptItem_ingredientId_idx" ON "InventoryReceiptItem"("ingredientId");
ALTER TABLE "InventoryReceiptItem" ADD CONSTRAINT "InventoryReceiptItem_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "InventoryReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryReceiptItem" ADD CONSTRAINT "InventoryReceiptItem_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "InventoryMovement" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "branchId" TEXT NOT NULL, "ingredientId" TEXT NOT NULL,
  "type" "InventoryMovementType" NOT NULL, "quantityBaseUnit" DECIMAL(14,4) NOT NULL,
  "unitCost" DECIMAL(12,6) NOT NULL DEFAULT 0, "referenceType" TEXT, "referenceId" TEXT,
  "idempotencyKey" TEXT NOT NULL, "actorUserId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InventoryMovement_idempotencyKey_key" ON "InventoryMovement"("idempotencyKey");
CREATE INDEX "InventoryMovement_tenantId_branchId_ingredientId_createdAt_idx" ON "InventoryMovement"("tenantId","branchId","ingredientId","createdAt");
CREATE INDEX "InventoryMovement_ingredientId_createdAt_idx" ON "InventoryMovement"("ingredientId","createdAt");
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "RecipeIngredient" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "productId" TEXT NOT NULL, "ingredientId" TEXT NOT NULL,
  "quantityBaseUnit" DECIMAL(14,4) NOT NULL, "wastePercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
  CONSTRAINT "RecipeIngredient_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RecipeIngredient_productId_ingredientId_key" ON "RecipeIngredient"("productId","ingredientId");
CREATE INDEX "RecipeIngredient_tenantId_productId_idx" ON "RecipeIngredient"("tenantId","productId");
ALTER TABLE "RecipeIngredient" ADD CONSTRAINT "RecipeIngredient_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecipeIngredient" ADD CONSTRAINT "RecipeIngredient_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecipeIngredient" ADD CONSTRAINT "RecipeIngredient_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
