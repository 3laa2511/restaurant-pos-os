-- Allow inventory movements to be recorded against either a branch warehouse or the central warehouse.
ALTER TABLE "InventoryMovement"
  ALTER COLUMN "branchId" DROP NOT NULL;

ALTER TABLE "InventoryMovement"
  ADD COLUMN "warehouseId" TEXT;

ALTER TABLE "InventoryMovement"
  ADD CONSTRAINT "InventoryMovement_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "InventoryMovement_tenantId_warehouseId_ingredientId_createdAt_idx"
  ON "InventoryMovement"("tenantId", "warehouseId", "ingredientId", "createdAt");

ALTER TABLE "InventoryMovement"
  ADD CONSTRAINT "inventory_movement_scope_check"
  CHECK (("branchId" IS NOT NULL) OR ("warehouseId" IS NOT NULL));

CREATE OR REPLACE FUNCTION enforce_inventory_movement_tenant_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.branchId IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "Branch" b
    WHERE b.id = NEW.branchId AND b."tenantId" = NEW."tenantId"
  ) THEN
    RAISE EXCEPTION 'InventoryMovement branch tenant mismatch';
  END IF;

  IF NEW.warehouseId IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "Warehouse" w
    WHERE w.id = NEW.warehouseId AND w."tenantId" = NEW."tenantId"
  ) THEN
    RAISE EXCEPTION 'InventoryMovement warehouse tenant mismatch';
  END IF;

  IF NEW.branchId IS NOT NULL AND NEW.warehouseId IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "Warehouse" w
    WHERE w.id = NEW.warehouseId AND w."branchId" = NEW.branchId
  ) THEN
    RAISE EXCEPTION 'InventoryMovement branch and warehouse mismatch';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inventory_movement_tenant_consistency ON "InventoryMovement";

CREATE TRIGGER inventory_movement_tenant_consistency
BEFORE INSERT OR UPDATE ON "InventoryMovement"
FOR EACH ROW
EXECUTE FUNCTION enforce_inventory_movement_tenant_consistency();
