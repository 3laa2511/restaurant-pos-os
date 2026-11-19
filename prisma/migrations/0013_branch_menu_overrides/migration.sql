CREATE TABLE "BranchProduct" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "priceOverride" DECIMAL(12,2),
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "available" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BranchProduct_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BranchProduct_branchId_productId_key"
  ON "BranchProduct"("branchId","productId");

CREATE INDEX "BranchProduct_tenantId_branchId_enabled_available_idx"
  ON "BranchProduct"("tenantId","branchId","enabled","available");

CREATE INDEX "BranchProduct_productId_branchId_idx"
  ON "BranchProduct"("productId","branchId");

ALTER TABLE "BranchProduct"
  ADD CONSTRAINT "BranchProduct_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BranchProduct"
  ADD CONSTRAINT "BranchProduct_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BranchProduct"
  ADD CONSTRAINT "BranchProduct_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
