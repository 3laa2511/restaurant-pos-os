CREATE TABLE "ProductVariant" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "sku" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "nameAr" TEXT,
  "price" DECIMAL(12,2) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ModifierGroup" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "nameAr" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "minSelections" INTEGER NOT NULL DEFAULT 0,
  "maxSelections" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ModifierGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ModifierOption" (
  "id" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "nameAr" TEXT,
  "priceDelta" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ModifierOption_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductModifierGroup" (
  "productId" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT false,
  "minSelections" INTEGER NOT NULL DEFAULT 0,
  "maxSelections" INTEGER NOT NULL DEFAULT 1,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "ProductModifierGroup_pkey" PRIMARY KEY ("productId","groupId")
);

ALTER TABLE "OrderItem" ADD COLUMN "variantId" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN "modifiers" JSONB;

CREATE UNIQUE INDEX "ProductVariant_sku_key" ON "ProductVariant"("sku");
CREATE INDEX "ProductVariant_productId_active_sortOrder_idx" ON "ProductVariant"("productId", "active", "sortOrder");
CREATE INDEX "ModifierOption_groupId_active_sortOrder_idx" ON "ModifierOption"("groupId", "active", "sortOrder");
CREATE INDEX "ProductModifierGroup_productId_sortOrder_idx" ON "ProductModifierGroup"("productId", "sortOrder");
CREATE INDEX "OrderItem_variantId_idx" ON "OrderItem"("variantId");

ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ModifierOption" ADD CONSTRAINT "ModifierOption_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ModifierGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductModifierGroup" ADD CONSTRAINT "ProductModifierGroup_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductModifierGroup" ADD CONSTRAINT "ProductModifierGroup_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ModifierGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
