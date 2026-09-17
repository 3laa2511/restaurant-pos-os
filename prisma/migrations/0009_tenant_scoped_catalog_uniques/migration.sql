-- Catalog identifiers are unique within a tenant, not globally.
-- This preserves the existing legacy data while allowing separate tenants
-- to independently use the same branch codes, product SKUs, and customer phones.

DROP INDEX IF EXISTS "Branch_code_key";
DROP INDEX IF EXISTS "Product_sku_key";
DROP INDEX IF EXISTS "Customer_phone_key";

CREATE UNIQUE INDEX "Branch_tenantId_code_key" ON "Branch"("tenantId", "code");
CREATE UNIQUE INDEX "Product_tenantId_sku_key" ON "Product"("tenantId", "sku");
CREATE UNIQUE INDEX "Customer_tenantId_phone_key" ON "Customer"("tenantId", "phone");
