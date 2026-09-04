CREATE TYPE "CashDrawerMovementType" AS ENUM ('OPENING_FLOAT', 'SALE', 'CASH_CHANGE', 'REFUND', 'PAY_IN', 'PAY_OUT', 'ADJUSTMENT');
CREATE TYPE "CashDrawerDirection" AS ENUM ('IN', 'OUT');

CREATE TABLE "CashDrawer" (
  "id" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CashDrawer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CashDrawerMovement" (
  "id" TEXT NOT NULL,
  "drawerId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "shiftId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" "CashDrawerMovementType" NOT NULL,
  "direction" "CashDrawerDirection" NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "reason" TEXT NOT NULL,
  "sourceType" TEXT,
  "sourceId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "metadata" JSONB,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CashDrawerMovement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CashDrawerMovement_amount_positive_check" CHECK ("amount" > 0)
);

CREATE UNIQUE INDEX "CashDrawer_deviceId_key" ON "CashDrawer"("deviceId");
CREATE INDEX "CashDrawer_branchId_active_idx" ON "CashDrawer"("branchId", "active");
CREATE UNIQUE INDEX "CashDrawerMovement_idempotencyKey_key" ON "CashDrawerMovement"("idempotencyKey");
CREATE UNIQUE INDEX "CashDrawerMovement_operationId_key" ON "CashDrawerMovement"("operationId");
CREATE INDEX "CashDrawerMovement_drawerId_occurredAt_idx" ON "CashDrawerMovement"("drawerId", "occurredAt");
CREATE INDEX "CashDrawerMovement_shiftId_occurredAt_idx" ON "CashDrawerMovement"("shiftId", "occurredAt");
CREATE INDEX "CashDrawerMovement_branchId_occurredAt_idx" ON "CashDrawerMovement"("branchId", "occurredAt");
CREATE INDEX "CashDrawerMovement_userId_occurredAt_idx" ON "CashDrawerMovement"("userId", "occurredAt");

ALTER TABLE "CashDrawer"
  ADD CONSTRAINT "CashDrawer_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashDrawer"
  ADD CONSTRAINT "CashDrawer_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashDrawerMovement"
  ADD CONSTRAINT "CashDrawerMovement_drawerId_fkey" FOREIGN KEY ("drawerId") REFERENCES "CashDrawer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashDrawerMovement"
  ADD CONSTRAINT "CashDrawerMovement_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashDrawerMovement"
  ADD CONSTRAINT "CashDrawerMovement_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashDrawerMovement"
  ADD CONSTRAINT "CashDrawerMovement_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashDrawerMovement"
  ADD CONSTRAINT "CashDrawerMovement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
