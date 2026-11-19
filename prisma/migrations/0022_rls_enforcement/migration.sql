-- Phase 5: enforce the RLS policies prepared in 0019, 0020 and 0021.
-- Every protected business table has an explicit policy. Tables intentionally
-- outside this list are global/auth-bootstrap tables and are not tenant data.

ALTER TABLE "Branch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Branch" FORCE ROW LEVEL SECURITY;
ALTER TABLE "AccountingAccount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AccountingAccount" FORCE ROW LEVEL SECURITY;
ALTER TABLE "JournalEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JournalEntry" FORCE ROW LEVEL SECURITY;
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" FORCE ROW LEVEL SECURITY;
ALTER TABLE "EmployeeProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EmployeeProfile" FORCE ROW LEVEL SECURITY;
ALTER TABLE "WorkSchedule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkSchedule" FORCE ROW LEVEL SECURITY;
ALTER TABLE "AttendanceRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AttendanceRecord" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PayrollPeriod" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PayrollPeriod" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PayrollEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PayrollEntry" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Supplier" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Supplier" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Ingredient" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Ingredient" FORCE ROW LEVEL SECURITY;
ALTER TABLE "InventoryStockBalance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryStockBalance" FORCE ROW LEVEL SECURITY;
ALTER TABLE "InventoryReceipt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryReceipt" FORCE ROW LEVEL SECURITY;
ALTER TABLE "InventoryMovement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryMovement" FORCE ROW LEVEL SECURITY;
ALTER TABLE "RecipeIngredient" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RecipeIngredient" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Warehouse" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Warehouse" FORCE ROW LEVEL SECURITY;
ALTER TABLE "WarehouseStockBalance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WarehouseStockBalance" FORCE ROW LEVEL SECURITY;
ALTER TABLE "InventoryTransfer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryTransfer" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Department" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Department" FORCE ROW LEVEL SECURITY;
ALTER TABLE "BranchProduct" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BranchProduct" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Category" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Category" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Product" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Product" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Customer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Customer" FORCE ROW LEVEL SECURITY;
ALTER TABLE "JournalLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JournalLine" FORCE ROW LEVEL SECURITY;
ALTER TABLE "UserRole" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserRole" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Device" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Device" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Order" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Order" FORCE ROW LEVEL SECURITY;
ALTER TABLE "OrderItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrderItem" FORCE ROW LEVEL SECURITY;
ALTER TABLE "OrderEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrderEvent" FORCE ROW LEVEL SECURITY;
ALTER TABLE "KitchenTicket" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KitchenTicket" FORCE ROW LEVEL SECURITY;
ALTER TABLE "KitchenTicketItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KitchenTicketItem" FORCE ROW LEVEL SECURITY;
ALTER TABLE "CustomerAddress" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomerAddress" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Payment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Payment" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PaymentAdjustment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentAdjustment" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Shift" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Shift" FORCE ROW LEVEL SECURITY;
ALTER TABLE "CashDrawer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CashDrawer" FORCE ROW LEVEL SECURITY;
ALTER TABLE "CashDrawerMovement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CashDrawerMovement" FORCE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;
ALTER TABLE "SyncOperation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SyncOperation" FORCE ROW LEVEL SECURITY;
ALTER TABLE "InventoryTransferItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryTransferItem" FORCE ROW LEVEL SECURITY;
ALTER TABLE "RiskPolicy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RiskPolicy" FORCE ROW LEVEL SECURITY;

-- Fail-safe verification: every enforced table must have at least one policy.
DO $$
DECLARE
  missing_count integer;
BEGIN
  SELECT count(*) INTO missing_count
  FROM (VALUES
    ('Branch'),
    ('AccountingAccount'),
    ('JournalEntry'),
    ('User'),
    ('EmployeeProfile'),
    ('WorkSchedule'),
    ('AttendanceRecord'),
    ('PayrollPeriod'),
    ('PayrollEntry'),
    ('Supplier'),
    ('Ingredient'),
    ('InventoryStockBalance'),
    ('InventoryReceipt'),
    ('InventoryMovement'),
    ('RecipeIngredient'),
    ('Warehouse'),
    ('WarehouseStockBalance'),
    ('InventoryTransfer'),
    ('Department'),
    ('BranchProduct'),
    ('Category'),
    ('Product'),
    ('Customer'),
    ('JournalLine'),
    ('UserRole'),
    ('Device'),
    ('Order'),
    ('OrderItem'),
    ('OrderEvent'),
    ('KitchenTicket'),
    ('KitchenTicketItem'),
    ('CustomerAddress'),
    ('Payment'),
    ('PaymentAdjustment'),
    ('Shift'),
    ('CashDrawer'),
    ('CashDrawerMovement'),
    ('AuditLog'),
    ('SyncOperation'),
    ('InventoryTransferItem'),
    ('RiskPolicy')
  ) AS expected(tablename)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND p.tablename = expected.tablename
  );

  IF missing_count > 0 THEN
    RAISE EXCEPTION 'RLS enforcement aborted: % protected tables have no policy', missing_count;
  END IF;
END $$;
