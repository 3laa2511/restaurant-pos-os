-- Phase 5 completion: close RLS gaps for dependent inventory rows and sessions.

CREATE OR REPLACE FUNCTION app.current_session_token_hash()
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.session_token_hash', true), '');
$$;

DROP POLICY IF EXISTS tenant_isolation ON "InventoryReceiptItem";
CREATE POLICY tenant_isolation ON "InventoryReceiptItem"
  USING (
    EXISTS (
      SELECT 1
      FROM "InventoryReceipt" r
      WHERE r.id = "InventoryReceiptItem"."receiptId"
        AND app.tenant_visible(r."tenantId")
        AND app.branch_visible(r."branchId")
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM "InventoryReceipt" r
      WHERE r.id = "InventoryReceiptItem"."receiptId"
        AND app.tenant_visible(r."tenantId")
        AND app.branch_visible(r."branchId")
    )
  );

DROP POLICY IF EXISTS session_bootstrap ON "Session";
DROP POLICY IF EXISTS session_isolation ON "Session";

CREATE POLICY session_bootstrap ON "Session"
  FOR SELECT
  USING (
    "tokenHash" = app.current_session_token_hash()
  );

CREATE POLICY session_isolation ON "Session"
  USING (
    app.tenant_visible("tenantId")
    AND app.branch_visible("branchId")
    AND "userId" = app.current_user_id()
  )
  WITH CHECK (
    app.tenant_visible("tenantId")
    AND app.branch_visible("branchId")
    AND "userId" = app.current_user_id()
  );

DROP POLICY IF EXISTS tenant_isolation ON "Tenant";
CREATE POLICY tenant_isolation ON "Tenant"
  USING (app.tenant_visible("id"))
  WITH CHECK (app.tenant_visible("id"));

ALTER TABLE "Tenant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Tenant" FORCE ROW LEVEL SECURITY;

ALTER TABLE "Session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Session" FORCE ROW LEVEL SECURITY;

ALTER TABLE "InventoryReceiptItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryReceiptItem" FORCE ROW LEVEL SECURITY;
