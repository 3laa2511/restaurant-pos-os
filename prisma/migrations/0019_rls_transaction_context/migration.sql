-- Phase 5: RLS foundation.
-- Policies are installed before enforcement because the API still has a small
-- number of Prisma reads outside RLS-scoped transactions. FORCE RLS is enabled
-- only after those paths are migrated; otherwise PostgreSQL default-deny would
-- break legitimate traffic.
CREATE SCHEMA IF NOT EXISTS app;

CREATE OR REPLACE FUNCTION app.current_tenant_id()
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '');
$$;

CREATE OR REPLACE FUNCTION app.current_branch_id()
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.branch_id', true), '');
$$;

CREATE OR REPLACE FUNCTION app.current_user_id()
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '');
$$;

CREATE OR REPLACE FUNCTION app.current_session_id()
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.session_id', true), '');
$$;

CREATE OR REPLACE FUNCTION app.tenant_visible(row_tenant_id text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT row_tenant_id = app.current_tenant_id();
$$;

CREATE OR REPLACE FUNCTION app.branch_visible(row_branch_id text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT row_branch_id IS NULL
      OR app.current_branch_id() IS NULL
      OR row_branch_id = app.current_branch_id();
$$;

-- Direct tenant-scoped tables. Policies are intentionally created while RLS
-- remains disabled; the enforcement migration will ENABLE + FORCE them after
-- all application access paths use setRlsContext()/withRlsContext().

DROP POLICY IF EXISTS tenant_isolation ON "Branch";
CREATE POLICY tenant_isolation ON "Branch"
  USING (app.tenant_visible("tenantId") AND app.branch_visible("id"))
  WITH CHECK (app.tenant_visible("tenantId") AND app.branch_visible("id"));

DROP POLICY IF EXISTS tenant_isolation ON "AccountingAccount";
CREATE POLICY tenant_isolation ON "AccountingAccount"
  USING (app.tenant_visible("tenantId"))
  WITH CHECK (app.tenant_visible("tenantId"));

DROP POLICY IF EXISTS tenant_isolation ON "JournalEntry";
CREATE POLICY tenant_isolation ON "JournalEntry"
  USING (app.tenant_visible("tenantId") AND app.branch_visible("branchId"))
  WITH CHECK (app.tenant_visible("tenantId") AND app.branch_visible("branchId"));

DROP POLICY IF EXISTS tenant_isolation ON "User";
CREATE POLICY tenant_isolation ON "User"
  USING (app.tenant_visible("tenantId") AND app.branch_visible("branchId"))
  WITH CHECK (app.tenant_visible("tenantId") AND app.branch_visible("branchId"));

DROP POLICY IF EXISTS tenant_isolation ON "EmployeeProfile";
CREATE POLICY tenant_isolation ON "EmployeeProfile"
  USING (app.tenant_visible("tenantId") AND EXISTS (
    SELECT 1 FROM "User" u
    WHERE u.id = "EmployeeProfile"."userId" AND app.branch_visible(u."branchId")
  ))
  WITH CHECK (app.tenant_visible("tenantId") AND EXISTS (
    SELECT 1 FROM "User" u
    WHERE u.id = "EmployeeProfile"."userId" AND app.branch_visible(u."branchId")
  ));

DROP POLICY IF EXISTS tenant_isolation ON "WorkSchedule";
CREATE POLICY tenant_isolation ON "WorkSchedule"
  USING (app.tenant_visible("tenantId") AND app.branch_visible("branchId"))
  WITH CHECK (app.tenant_visible("tenantId") AND app.branch_visible("branchId"));

DROP POLICY IF EXISTS tenant_isolation ON "AttendanceRecord";
CREATE POLICY tenant_isolation ON "AttendanceRecord"
  USING (app.tenant_visible("tenantId") AND app.branch_visible("branchId"))
  WITH CHECK (app.tenant_visible("tenantId") AND app.branch_visible("branchId"));

DROP POLICY IF EXISTS tenant_isolation ON "PayrollPeriod";
CREATE POLICY tenant_isolation ON "PayrollPeriod"
  USING (app.tenant_visible("tenantId"))
  WITH CHECK (app.tenant_visible("tenantId"));

DROP POLICY IF EXISTS tenant_isolation ON "PayrollEntry";
CREATE POLICY tenant_isolation ON "PayrollEntry"
  USING (app.tenant_visible("tenantId") AND EXISTS (
    SELECT 1 FROM "User" u
    WHERE u.id = "PayrollEntry"."userId" AND app.branch_visible(u."branchId")
  ))
  WITH CHECK (app.tenant_visible("tenantId") AND EXISTS (
    SELECT 1 FROM "User" u
    WHERE u.id = "PayrollEntry"."userId" AND app.branch_visible(u."branchId")
  ));

DROP POLICY IF EXISTS tenant_isolation ON "Supplier";
CREATE POLICY tenant_isolation ON "Supplier"
  USING (app.tenant_visible("tenantId"))
  WITH CHECK (app.tenant_visible("tenantId"));

DROP POLICY IF EXISTS tenant_isolation ON "Ingredient";
CREATE POLICY tenant_isolation ON "Ingredient"
  USING (app.tenant_visible("tenantId"))
  WITH CHECK (app.tenant_visible("tenantId"));

DROP POLICY IF EXISTS tenant_isolation ON "InventoryStockBalance";
CREATE POLICY tenant_isolation ON "InventoryStockBalance"
  USING (app.tenant_visible("tenantId") AND app.branch_visible("branchId"))
  WITH CHECK (app.tenant_visible("tenantId") AND app.branch_visible("branchId"));

DROP POLICY IF EXISTS tenant_isolation ON "InventoryReceipt";
CREATE POLICY tenant_isolation ON "InventoryReceipt"
  USING (app.tenant_visible("tenantId") AND app.branch_visible("branchId"))
  WITH CHECK (app.tenant_visible("tenantId") AND app.branch_visible("branchId"));

DROP POLICY IF EXISTS tenant_isolation ON "InventoryMovement";
CREATE POLICY tenant_isolation ON "InventoryMovement"
  USING (app.tenant_visible("tenantId") AND app.branch_visible("branchId"))
  WITH CHECK (app.tenant_visible("tenantId") AND app.branch_visible("branchId"));

DROP POLICY IF EXISTS tenant_isolation ON "RecipeIngredient";
CREATE POLICY tenant_isolation ON "RecipeIngredient"
  USING (app.tenant_visible("tenantId"))
  WITH CHECK (app.tenant_visible("tenantId"));

DROP POLICY IF EXISTS tenant_isolation ON "Warehouse";
CREATE POLICY tenant_isolation ON "Warehouse"
  USING (app.tenant_visible("tenantId") AND app.branch_visible("branchId"))
  WITH CHECK (app.tenant_visible("tenantId") AND app.branch_visible("branchId"));

DROP POLICY IF EXISTS tenant_isolation ON "WarehouseStockBalance";
CREATE POLICY tenant_isolation ON "WarehouseStockBalance"
  USING (app.tenant_visible("tenantId") AND EXISTS (
    SELECT 1 FROM "Warehouse" w
    WHERE w.id = "WarehouseStockBalance"."warehouseId" AND app.branch_visible(w."branchId")
  ))
  WITH CHECK (app.tenant_visible("tenantId") AND EXISTS (
    SELECT 1 FROM "Warehouse" w
    WHERE w.id = "WarehouseStockBalance"."warehouseId" AND app.branch_visible(w."branchId")
  ));

DROP POLICY IF EXISTS tenant_isolation ON "InventoryTransfer";
CREATE POLICY tenant_isolation ON "InventoryTransfer"
  USING (app.tenant_visible("tenantId") AND EXISTS (
    SELECT 1 FROM "Warehouse" from_w
    WHERE from_w.id = "InventoryTransfer"."fromWarehouseId" AND app.branch_visible(from_w."branchId")
  ) AND EXISTS (
    SELECT 1 FROM "Warehouse" to_w
    WHERE to_w.id = "InventoryTransfer"."toWarehouseId" AND app.branch_visible(to_w."branchId")
  ))
  WITH CHECK (app.tenant_visible("tenantId") AND EXISTS (
    SELECT 1 FROM "Warehouse" from_w
    WHERE from_w.id = "InventoryTransfer"."fromWarehouseId" AND app.branch_visible(from_w."branchId")
  ) AND EXISTS (
    SELECT 1 FROM "Warehouse" to_w
    WHERE to_w.id = "InventoryTransfer"."toWarehouseId" AND app.branch_visible(to_w."branchId")
  ));

DROP POLICY IF EXISTS tenant_isolation ON "Department";
CREATE POLICY tenant_isolation ON "Department"
  USING (app.tenant_visible("tenantId") AND app.branch_visible("branchId"))
  WITH CHECK (app.tenant_visible("tenantId") AND app.branch_visible("branchId"));

DROP POLICY IF EXISTS tenant_isolation ON "BranchProduct";
CREATE POLICY tenant_isolation ON "BranchProduct"
  USING (app.tenant_visible("tenantId") AND app.branch_visible("branchId"))
  WITH CHECK (app.tenant_visible("tenantId") AND app.branch_visible("branchId"));

DROP POLICY IF EXISTS tenant_isolation ON "Category";
CREATE POLICY tenant_isolation ON "Category"
  USING (app.tenant_visible("tenantId"))
  WITH CHECK (app.tenant_visible("tenantId"));

DROP POLICY IF EXISTS tenant_isolation ON "Product";
CREATE POLICY tenant_isolation ON "Product"
  USING (app.tenant_visible("tenantId"))
  WITH CHECK (app.tenant_visible("tenantId"));

DROP POLICY IF EXISTS tenant_isolation ON "Customer";
CREATE POLICY tenant_isolation ON "Customer"
  USING (app.tenant_visible("tenantId"))
  WITH CHECK (app.tenant_visible("tenantId"));


-- Derived tenant-scoped tables. These policies follow the owning tenant/branch
-- through their foreign-key parent instead of trusting a client-supplied tenantId.

DROP POLICY IF EXISTS tenant_isolation ON "JournalLine";
CREATE POLICY tenant_isolation ON "JournalLine"
  USING (EXISTS (
    SELECT 1 FROM "JournalEntry" e
    WHERE e.id = "JournalLine"."entryId"
      AND app.tenant_visible(e."tenantId")
      AND app.branch_visible("JournalLine"."branchId")
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "JournalEntry" e
    WHERE e.id = "JournalLine"."entryId"
      AND app.tenant_visible(e."tenantId")
      AND app.branch_visible("JournalLine"."branchId")
  ));

DROP POLICY IF EXISTS tenant_isolation ON "UserRole";
CREATE POLICY tenant_isolation ON "UserRole"
  USING (EXISTS (
    SELECT 1 FROM "User" u
    WHERE u.id = "UserRole"."userId"
      AND app.tenant_visible(u."tenantId")
      AND app.branch_visible(u."branchId")
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "User" u
    WHERE u.id = "UserRole"."userId"
      AND app.tenant_visible(u."tenantId")
      AND app.branch_visible(u."branchId")
  ));

DROP POLICY IF EXISTS tenant_isolation ON "Device";
CREATE POLICY tenant_isolation ON "Device"
  USING (EXISTS (
    SELECT 1 FROM "Branch" b
    WHERE b.id = "Device"."branchId"
      AND app.tenant_visible(b."tenantId")
      AND app.branch_visible(b.id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Branch" b
    WHERE b.id = "Device"."branchId"
      AND app.tenant_visible(b."tenantId")
      AND app.branch_visible(b.id)
  ));

DROP POLICY IF EXISTS tenant_isolation ON "Order";
CREATE POLICY tenant_isolation ON "Order"
  USING (EXISTS (
    SELECT 1 FROM "Branch" b
    WHERE b.id = "Order"."branchId"
      AND app.tenant_visible(b."tenantId")
      AND app.branch_visible(b.id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Branch" b
    WHERE b.id = "Order"."branchId"
      AND app.tenant_visible(b."tenantId")
      AND app.branch_visible(b.id)
  ));

DROP POLICY IF EXISTS tenant_isolation ON "OrderItem";
CREATE POLICY tenant_isolation ON "OrderItem"
  USING (EXISTS (
    SELECT 1 FROM "Order" o
    WHERE o.id = "OrderItem"."orderId"
      AND EXISTS (
        SELECT 1 FROM "Branch" b
        WHERE b.id = o."branchId"
          AND app.tenant_visible(b."tenantId")
          AND app.branch_visible(b.id)
      )
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Order" o
    WHERE o.id = "OrderItem"."orderId"
      AND EXISTS (
        SELECT 1 FROM "Branch" b
        WHERE b.id = o."branchId"
          AND app.tenant_visible(b."tenantId")
          AND app.branch_visible(b.id)
      )
  ));

DROP POLICY IF EXISTS tenant_isolation ON "OrderEvent";
CREATE POLICY tenant_isolation ON "OrderEvent"
  USING (EXISTS (
    SELECT 1 FROM "Order" o
    WHERE o.id = "OrderEvent"."orderId"
      AND EXISTS (
        SELECT 1 FROM "Branch" b
        WHERE b.id = o."branchId"
          AND app.tenant_visible(b."tenantId")
          AND app.branch_visible(b.id)
      )
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Order" o
    WHERE o.id = "OrderEvent"."orderId"
      AND EXISTS (
        SELECT 1 FROM "Branch" b
        WHERE b.id = o."branchId"
          AND app.tenant_visible(b."tenantId")
          AND app.branch_visible(b.id)
      )
  ));

DROP POLICY IF EXISTS tenant_isolation ON "KitchenTicket";
CREATE POLICY tenant_isolation ON "KitchenTicket"
  USING (EXISTS (
    SELECT 1 FROM "Branch" b
    WHERE b.id = "KitchenTicket"."branchId"
      AND app.tenant_visible(b."tenantId")
      AND app.branch_visible(b.id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Branch" b
    WHERE b.id = "KitchenTicket"."branchId"
      AND app.tenant_visible(b."tenantId")
      AND app.branch_visible(b.id)
  ));

DROP POLICY IF EXISTS tenant_isolation ON "KitchenTicketItem";
CREATE POLICY tenant_isolation ON "KitchenTicketItem"
  USING (EXISTS (
    SELECT 1 FROM "KitchenTicket" t
    WHERE t.id = "KitchenTicketItem"."ticketId"
      AND EXISTS (
        SELECT 1 FROM "Branch" b
        WHERE b.id = t."branchId"
          AND app.tenant_visible(b."tenantId")
          AND app.branch_visible(b.id)
      )
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "KitchenTicket" t
    WHERE t.id = "KitchenTicketItem"."ticketId"
      AND EXISTS (
        SELECT 1 FROM "Branch" b
        WHERE b.id = t."branchId"
          AND app.tenant_visible(b."tenantId")
          AND app.branch_visible(b.id)
      )
  ));

DROP POLICY IF EXISTS tenant_isolation ON "CustomerAddress";
CREATE POLICY tenant_isolation ON "CustomerAddress"
  USING (EXISTS (
    SELECT 1 FROM "Customer" c
    WHERE c.id = "CustomerAddress"."customerId"
      AND app.tenant_visible(c."tenantId")
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Customer" c
    WHERE c.id = "CustomerAddress"."customerId"
      AND app.tenant_visible(c."tenantId")
  ));

DROP POLICY IF EXISTS tenant_isolation ON "Payment";
CREATE POLICY tenant_isolation ON "Payment"
  USING (EXISTS (
    SELECT 1 FROM "Order" o
    JOIN "Branch" b ON b.id = o."branchId"
    WHERE o.id = "Payment"."orderId"
      AND app.tenant_visible(b."tenantId")
      AND app.branch_visible(b.id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Order" o
    JOIN "Branch" b ON b.id = o."branchId"
    WHERE o.id = "Payment"."orderId"
      AND app.tenant_visible(b."tenantId")
      AND app.branch_visible(b.id)
  ));

DROP POLICY IF EXISTS tenant_isolation ON "PaymentAdjustment";
CREATE POLICY tenant_isolation ON "PaymentAdjustment"
  USING (EXISTS (
    SELECT 1 FROM "Order" o
    JOIN "Branch" b ON b.id = o."branchId"
    WHERE o.id = "PaymentAdjustment"."orderId"
      AND app.tenant_visible(b."tenantId")
      AND app.branch_visible(b.id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Order" o
    JOIN "Branch" b ON b.id = o."branchId"
    WHERE o.id = "PaymentAdjustment"."orderId"
      AND app.tenant_visible(b."tenantId")
      AND app.branch_visible(b.id)
  ));

DROP POLICY IF EXISTS tenant_isolation ON "Shift";
CREATE POLICY tenant_isolation ON "Shift"
  USING (EXISTS (
    SELECT 1 FROM "Branch" b
    WHERE b.id = "Shift"."branchId"
      AND app.tenant_visible(b."tenantId")
      AND app.branch_visible(b.id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Branch" b
    WHERE b.id = "Shift"."branchId"
      AND app.tenant_visible(b."tenantId")
      AND app.branch_visible(b.id)
  ));

DROP POLICY IF EXISTS tenant_isolation ON "CashDrawer";
CREATE POLICY tenant_isolation ON "CashDrawer"
  USING (EXISTS (
    SELECT 1 FROM "Branch" b
    WHERE b.id = "CashDrawer"."branchId"
      AND app.tenant_visible(b."tenantId")
      AND app.branch_visible(b.id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Branch" b
    WHERE b.id = "CashDrawer"."branchId"
      AND app.tenant_visible(b."tenantId")
      AND app.branch_visible(b.id)
  ));

DROP POLICY IF EXISTS tenant_isolation ON "CashDrawerMovement";
CREATE POLICY tenant_isolation ON "CashDrawerMovement"
  USING (EXISTS (
    SELECT 1 FROM "Branch" b
    WHERE b.id = "CashDrawerMovement"."branchId"
      AND app.tenant_visible(b."tenantId")
      AND app.branch_visible(b.id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Branch" b
    WHERE b.id = "CashDrawerMovement"."branchId"
      AND app.tenant_visible(b."tenantId")
      AND app.branch_visible(b.id)
  ));

DROP POLICY IF EXISTS tenant_isolation ON "AuditLog";
CREATE POLICY tenant_isolation ON "AuditLog"
  USING (
    ("AuditLog"."branchId" IS NOT NULL AND EXISTS (
      SELECT 1 FROM "Branch" b
      WHERE b.id = "AuditLog"."branchId"
        AND app.tenant_visible(b."tenantId")
        AND app.branch_visible(b.id)
    ))
    OR
    ("AuditLog"."actorUserId" IS NOT NULL AND EXISTS (
      SELECT 1 FROM "User" u
      WHERE u.id = "AuditLog"."actorUserId"
        AND app.tenant_visible(u."tenantId")
        AND app.branch_visible(u."branchId")
    ))
  )
  WITH CHECK (
    ("AuditLog"."branchId" IS NOT NULL AND EXISTS (
      SELECT 1 FROM "Branch" b
      WHERE b.id = "AuditLog"."branchId"
        AND app.tenant_visible(b."tenantId")
        AND app.branch_visible(b.id)
    ))
    OR
    ("AuditLog"."actorUserId" IS NOT NULL AND EXISTS (
      SELECT 1 FROM "User" u
      WHERE u.id = "AuditLog"."actorUserId"
        AND app.tenant_visible(u."tenantId")
        AND app.branch_visible(u."branchId")
    ))
  );

DROP POLICY IF EXISTS tenant_isolation ON "SyncOperation";
CREATE POLICY tenant_isolation ON "SyncOperation"
  USING (EXISTS (
    SELECT 1 FROM "Branch" b
    WHERE b.id = "SyncOperation"."branchId"
      AND app.tenant_visible(b."tenantId")
      AND app.branch_visible(b.id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Branch" b
    WHERE b.id = "SyncOperation"."branchId"
      AND app.tenant_visible(b."tenantId")
      AND app.branch_visible(b.id)
  ));

DROP POLICY IF EXISTS tenant_isolation ON "InventoryTransferItem";
CREATE POLICY tenant_isolation ON "InventoryTransferItem"
  USING (EXISTS (
    SELECT 1 FROM "InventoryTransfer" t
    WHERE t.id = "InventoryTransferItem"."transferId"
      AND app.tenant_visible(t."tenantId")
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "InventoryTransfer" t
    WHERE t.id = "InventoryTransferItem"."transferId"
      AND app.tenant_visible(t."tenantId")
  ));

-- RiskPolicy is intentionally excluded: nullable branchId without tenantId cannot prove tenant ownership for central policies. Phase 5 schema hardening must add tenantId before enabling RLS on this table.\n\n-- Tenant remains outside business-data RLS because authentication must establish tenant context before protected queries.\n-- Session/auth access is isolated in the enforcement phase.\n