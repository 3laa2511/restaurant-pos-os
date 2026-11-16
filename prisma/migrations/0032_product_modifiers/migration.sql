-- Tenant-scoped product modifiers and immutable order-line selection snapshots.
CREATE TABLE "ProductModifierGroup" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "nameAr" TEXT,
  "required" BOOLEAN NOT NULL DEFAULT false,
  "minSelections" INTEGER NOT NULL DEFAULT 0,
  "maxSelections" INTEGER NOT NULL DEFAULT 1,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductModifierGroup_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductModifierGroup_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProductModifierGroup_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProductModifierGroup_selection_bounds_check"
    CHECK ("minSelections" >= 0 AND "maxSelections" >= 1 AND "minSelections" <= "maxSelections" AND (NOT "required" OR "minSelections" >= 1)),
  CONSTRAINT "ProductModifierGroup_name_check"
    CHECK (length(btrim("name")) > 0)
);
CREATE UNIQUE INDEX "ProductModifierGroup_id_tenantId_key"
  ON "ProductModifierGroup"("id", "tenantId");
CREATE INDEX "ProductModifierGroup_tenantId_productId_active_sortOrder_idx"
  ON "ProductModifierGroup"("tenantId", "productId", "active", "sortOrder");

CREATE TABLE "ProductModifierOption" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "nameAr" TEXT,
  "priceDelta" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductModifierOption_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductModifierOption_group_tenant_fkey"
    FOREIGN KEY ("groupId", "tenantId")
    REFERENCES "ProductModifierGroup"("id", "tenantId")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProductModifierOption_name_check"
    CHECK (length(btrim("name")) > 0)
);
CREATE INDEX "ProductModifierOption_tenantId_groupId_active_sortOrder_idx"
  ON "ProductModifierOption"("tenantId", "groupId", "active", "sortOrder");

ALTER TABLE "OrderItem" ADD COLUMN "modifierSnapshot" JSONB;

-- The snapshot is intentionally immutable through the API after order creation.
-- RLS prevents either table from being used to cross tenant boundaries.
ALTER TABLE "ProductModifierGroup" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductModifierGroup" FORCE ROW LEVEL SECURITY;
CREATE POLICY product_modifier_group_tenant_scope ON "ProductModifierGroup"
  USING (
    app.tenant_visible("tenantId")
    AND EXISTS (
      SELECT 1 FROM "Product" p
      WHERE p."id" = "ProductModifierGroup"."productId"
        AND p."tenantId" = "ProductModifierGroup"."tenantId"
    )
  )
  WITH CHECK (
    app.tenant_visible("tenantId")
    AND EXISTS (
      SELECT 1 FROM "Product" p
      WHERE p."id" = "ProductModifierGroup"."productId"
        AND p."tenantId" = "ProductModifierGroup"."tenantId"
    )
  );

ALTER TABLE "ProductModifierOption" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductModifierOption" FORCE ROW LEVEL SECURITY;
CREATE POLICY product_modifier_option_tenant_scope ON "ProductModifierOption"
  USING (
    app.tenant_visible("tenantId")
    AND EXISTS (
      SELECT 1 FROM "ProductModifierGroup" g
      WHERE g."id" = "ProductModifierOption"."groupId"
        AND g."tenantId" = "ProductModifierOption"."tenantId"
    )
  )
  WITH CHECK (
    app.tenant_visible("tenantId")
    AND EXISTS (
      SELECT 1 FROM "ProductModifierGroup" g
      WHERE g."id" = "ProductModifierOption"."groupId"
        AND g."tenantId" = "ProductModifierOption"."tenantId"
    )
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ProductModifierGroup'
      AND policyname = 'product_modifier_group_tenant_scope'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ProductModifierOption'
      AND policyname = 'product_modifier_option_tenant_scope'
  ) THEN
    RAISE EXCEPTION 'Product modifier RLS policies are required';
  END IF;
END $$;
