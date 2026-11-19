-- Provider webhook bootstrap and idempotent inbox.
-- The endpoint key is stored only as a SHA-256 hash. Raw provider payloads and
-- credentials are intentionally not persisted by this inbox table.

ALTER TABLE "PaymentProviderAccount"
  ADD COLUMN "webhookKeyHash" TEXT;

CREATE UNIQUE INDEX "PaymentProviderAccount_webhookKeyHash_key"
  ON "PaymentProviderAccount" ("webhookKeyHash");

CREATE OR REPLACE FUNCTION app.current_provider_endpoint_hash()
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.provider_endpoint_hash', true), '');
$$;

CREATE OR REPLACE FUNCTION app.current_provider_account_id()
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.provider_account_id', true), '');
$$;

-- Bootstrap reads are limited to one active account whose stored endpoint
-- hash matches the high-entropy endpoint key presented by the caller.
DROP POLICY IF EXISTS provider_webhook_bootstrap_read ON "PaymentProviderAccount";
CREATE POLICY provider_webhook_bootstrap_read ON "PaymentProviderAccount"
  FOR SELECT
  USING (
    "active" = true
    AND "webhookKeyHash" IS NOT NULL
    AND "webhookKeyHash" = app.current_provider_endpoint_hash()
  );

-- After resolving the endpoint key, processing runs with only the resolved
-- provider account ID in transaction-local context. This policy grants no
-- tenant-wide access and cannot be used to select a different account.
DROP POLICY IF EXISTS provider_account_scoped_read ON "PaymentProviderAccount";
CREATE POLICY provider_account_scoped_read ON "PaymentProviderAccount"
  FOR SELECT
  USING ("id" = app.current_provider_account_id());

CREATE TABLE "PaymentProviderEvent" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "providerAccountId" TEXT NOT NULL,
  "providerEventId" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "signatureValid" BOOLEAN NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RECEIVED',
  "processedAt" TIMESTAMP(3),
  "errorCode" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentProviderEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentProviderEvent_providerAccountId_tenantId_fkey"
    FOREIGN KEY ("providerAccountId", "tenantId")
    REFERENCES "PaymentProviderAccount"("id", "tenantId")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PaymentProviderEvent_providerEventId_check"
    CHECK (length(btrim("providerEventId")) > 0),
  CONSTRAINT "PaymentProviderEvent_payloadHash_check"
    CHECK ("payloadHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "PaymentProviderEvent_status_check"
    CHECK ("status" IN ('RECEIVED', 'PROCESSING', 'PROCESSED', 'REJECTED', 'RETRYABLE'))
);

CREATE UNIQUE INDEX "PaymentProviderEvent_providerAccountId_providerEventId_key"
  ON "PaymentProviderEvent" ("providerAccountId", "providerEventId");
CREATE INDEX "PaymentProviderEvent_tenantId_status_receivedAt_idx"
  ON "PaymentProviderEvent" ("tenantId", "status", "receivedAt");
CREATE INDEX "PaymentProviderEvent_providerAccountId_receivedAt_idx"
  ON "PaymentProviderEvent" ("providerAccountId", "receivedAt");

-- A provider-account-scoped transaction can only see/write inbox rows for the
-- one account selected by the opaque endpoint key and then resolved by API.
DROP POLICY IF EXISTS provider_account_event_scope ON "PaymentProviderEvent";
CREATE POLICY provider_account_event_scope ON "PaymentProviderEvent"
  USING (
    "providerAccountId" = app.current_provider_account_id()
    AND EXISTS (
      SELECT 1 FROM "PaymentProviderAccount" a
      WHERE a."id" = "PaymentProviderEvent"."providerAccountId"
        AND a."tenantId" = "PaymentProviderEvent"."tenantId"
    )
  )
  WITH CHECK (
    "providerAccountId" = app.current_provider_account_id()
    AND EXISTS (
      SELECT 1 FROM "PaymentProviderAccount" a
      WHERE a."id" = "PaymentProviderEvent"."providerAccountId"
        AND a."tenantId" = "PaymentProviderEvent"."tenantId"
    )
  );

ALTER TABLE "PaymentProviderEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentProviderEvent" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'PaymentProviderEvent'
      AND policyname = 'provider_account_event_scope'
  ) THEN
    RAISE EXCEPTION 'PaymentProviderEvent RLS policy missing';
  END IF;
END $$;
