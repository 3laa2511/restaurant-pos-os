-- Payment Hub foundation: provider accounts, order-scoped intents and attempt history.
-- Provider callbacks are deliberately NOT enabled by this migration. The webhook
-- inbox is deferred until its unauthenticated bootstrap path is implemented and tested.

CREATE TYPE "PaymentIntentStatus" AS ENUM (
  'CREATED',
  'PENDING',
  'PROCESSING',
  'SUCCEEDED',
  'FAILED',
  'EXPIRED',
  'CANCELLED',
  'REVIEW_REQUIRED'
);

CREATE TYPE "PaymentIntentChannel" AS ENUM (
  'DIRECT_TRANSFER',
  'CHECKOUT_LINK',
  'QR'
);

-- Composite unique keys support tenant/branch-safe foreign keys below.
CREATE UNIQUE INDEX "Branch_id_tenantId_key" ON "Branch" ("id", "tenantId");
CREATE UNIQUE INDEX "Order_id_branchId_key" ON "Order" ("id", "branchId");

CREATE TABLE "PaymentProviderAccount" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "branchId" TEXT,
  "providerCode" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "accountReferenceMasked" TEXT,
  "credentialSecretRef" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'EGP',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentProviderAccount_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentProviderAccount_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PaymentProviderAccount_branchId_tenantId_fkey"
    FOREIGN KEY ("branchId", "tenantId") REFERENCES "Branch"("id", "tenantId")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PaymentProviderAccount_providerCode_check"
    CHECK (length(btrim("providerCode")) > 0),
  CONSTRAINT "PaymentProviderAccount_displayName_check"
    CHECK (length(btrim("displayName")) > 0)
);

CREATE UNIQUE INDEX "PaymentProviderAccount_id_tenantId_key"
  ON "PaymentProviderAccount" ("id", "tenantId");
CREATE UNIQUE INDEX "PaymentProviderAccount_tenantId_providerCode_displayName_key"
  ON "PaymentProviderAccount" ("tenantId", "providerCode", "displayName");
CREATE INDEX "PaymentProviderAccount_tenantId_branchId_active_idx"
  ON "PaymentProviderAccount" ("tenantId", "branchId", "active");

CREATE TABLE "PaymentIntent" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "providerAccountId" TEXT NOT NULL,
  "channel" "PaymentIntentChannel" NOT NULL,
  "amountMinor" BIGINT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'EGP',
  "status" "PaymentIntentStatus" NOT NULL DEFAULT 'CREATED',
  "merchantReference" TEXT NOT NULL,
  "checkoutUrl" TEXT,
  "expiresAt" TIMESTAMP(3),
  "succeededAt" TIMESTAMP(3),
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentIntent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentIntent_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PaymentIntent_branchId_tenantId_fkey"
    FOREIGN KEY ("branchId", "tenantId") REFERENCES "Branch"("id", "tenantId")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PaymentIntent_orderId_branchId_fkey"
    FOREIGN KEY ("orderId", "branchId") REFERENCES "Order"("id", "branchId")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PaymentIntent_providerAccountId_tenantId_fkey"
    FOREIGN KEY ("providerAccountId", "tenantId") REFERENCES "PaymentProviderAccount"("id", "tenantId")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PaymentIntent_amountMinor_check" CHECK ("amountMinor" > 0),
  CONSTRAINT "PaymentIntent_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "PaymentIntent_merchantReference_check"
    CHECK (length(btrim("merchantReference")) > 0),
  CONSTRAINT "PaymentIntent_idempotencyKey_check"
    CHECK (length(btrim("idempotencyKey")) > 0)
);

CREATE UNIQUE INDEX "PaymentIntent_id_tenantId_key" ON "PaymentIntent" ("id", "tenantId");
CREATE UNIQUE INDEX "PaymentIntent_tenantId_merchantReference_key"
  ON "PaymentIntent" ("tenantId", "merchantReference");
CREATE UNIQUE INDEX "PaymentIntent_tenantId_idempotencyKey_key"
  ON "PaymentIntent" ("tenantId", "idempotencyKey");
CREATE INDEX "PaymentIntent_tenantId_branchId_status_createdAt_idx"
  ON "PaymentIntent" ("tenantId", "branchId", "status", "createdAt");
CREATE INDEX "PaymentIntent_orderId_createdAt_idx" ON "PaymentIntent" ("orderId", "createdAt");
CREATE INDEX "PaymentIntent_providerAccountId_status_createdAt_idx"
  ON "PaymentIntent" ("providerAccountId", "status", "createdAt");

CREATE TABLE "PaymentAttempt" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "intentId" TEXT NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "providerRequestId" TEXT,
  "providerTransactionId" TEXT,
  "status" TEXT NOT NULL,
  "failureCode" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentAttempt_intentId_tenantId_fkey"
    FOREIGN KEY ("intentId", "tenantId") REFERENCES "PaymentIntent"("id", "tenantId")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PaymentAttempt_attemptNumber_check" CHECK ("attemptNumber" > 0),
  CONSTRAINT "PaymentAttempt_status_check" CHECK (length(btrim("status")) > 0)
);

CREATE UNIQUE INDEX "PaymentAttempt_intentId_attemptNumber_key"
  ON "PaymentAttempt" ("intentId", "attemptNumber");
CREATE UNIQUE INDEX "PaymentAttempt_tenantId_providerTransactionId_key"
  ON "PaymentAttempt" ("tenantId", "providerTransactionId");
CREATE INDEX "PaymentAttempt_tenantId_createdAt_idx"
  ON "PaymentAttempt" ("tenantId", "createdAt");

-- Tenant/branch isolation is enforced from day one for these new tables.
DROP POLICY IF EXISTS tenant_isolation ON "PaymentProviderAccount";
CREATE POLICY tenant_isolation ON "PaymentProviderAccount"
  USING (app.tenant_visible("tenantId") AND app.branch_visible("branchId"))
  WITH CHECK (app.tenant_visible("tenantId") AND app.branch_visible("branchId"));

DROP POLICY IF EXISTS tenant_isolation ON "PaymentIntent";
CREATE POLICY tenant_isolation ON "PaymentIntent"
  USING (app.tenant_visible("tenantId") AND app.branch_visible("branchId"))
  WITH CHECK (app.tenant_visible("tenantId") AND app.branch_visible("branchId"));

DROP POLICY IF EXISTS tenant_isolation ON "PaymentAttempt";
CREATE POLICY tenant_isolation ON "PaymentAttempt"
  USING (EXISTS (
    SELECT 1 FROM "PaymentIntent" i
    WHERE i."id" = "PaymentAttempt"."intentId"
      AND i."tenantId" = "PaymentAttempt"."tenantId"
      AND app.tenant_visible(i."tenantId")
      AND app.branch_visible(i."branchId")
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "PaymentIntent" i
    WHERE i."id" = "PaymentAttempt"."intentId"
      AND i."tenantId" = "PaymentAttempt"."tenantId"
      AND app.tenant_visible(i."tenantId")
      AND app.branch_visible(i."branchId")
  ));

ALTER TABLE "PaymentProviderAccount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentProviderAccount" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PaymentIntent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentIntent" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PaymentAttempt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentAttempt" FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['PaymentProviderAccount', 'PaymentIntent', 'PaymentAttempt']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = table_name
    ) THEN
      RAISE EXCEPTION 'Payment Hub RLS policy missing for %', table_name;
    END IF;
  END LOOP;
END $$;
