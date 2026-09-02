CREATE TABLE "SyncOperation" (
  "id" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "clientSequence" INTEGER NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "payload" JSONB NOT NULL,
  "requestHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RECEIVED',
  "result" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SyncOperation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SyncOperation_operationId_key" ON "SyncOperation"("operationId");
CREATE UNIQUE INDEX "SyncOperation_idempotencyKey_key" ON "SyncOperation"("idempotencyKey");
CREATE INDEX "SyncOperation_deviceId_clientSequence_idx" ON "SyncOperation"("deviceId", "clientSequence");
CREATE INDEX "SyncOperation_status_createdAt_idx" ON "SyncOperation"("status", "createdAt");
