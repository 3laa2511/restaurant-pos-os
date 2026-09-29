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
  USING (app.tenant_visible("tenantId"))
  WITH CHECK (app.tenant_visible("tenantId"));

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
  USING (app.tenant_visible("tenantId"))
  WITH CHECK (app.tenant_visible("tenantId"));

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
  USING (app.tenant_visible("tenantId"))
  WITH CHECK (app.tenant_visible("tenantId"));

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
  USING (app.tenant_visible("tenantId"))
  WITH CHECK (app.tenant_visible("tenantId"));

DROP POLICY IF EXISTS tenant_isolation ON "InventoryTransfer";
CREATE POLICY tenant_isolation ON "InventoryTransfer"
  USING (app.tenant_visible("tenantId"))
  WITH CHECK (app.tenant_visible("tenantId"));

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

-- Tenant remains outside business-data RLS because authentication must establish
-- tenant context before protected queries. Session/auth access is isolated in
-- the enforcement phase.
