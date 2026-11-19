-- Add tenant-scoped idempotency for inventory receipts without invalidating existing rows.
ALTER TABLE "InventoryReceipt" ADD COLUMN "idempotencyKey" TEXT;

UPDATE "InventoryReceipt"
SET "idempotencyKey" = 'legacy-receipt:' || "id"
WHERE "idempotencyKey" IS NULL;

ALTER TABLE "InventoryReceipt" ALTER COLUMN "idempotencyKey" SET NOT NULL;

CREATE UNIQUE INDEX "InventoryReceipt_tenantId_idempotencyKey_key"
ON "InventoryReceipt" ("tenantId", "idempotencyKey");
