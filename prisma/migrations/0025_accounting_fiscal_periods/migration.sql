CREATE TYPE "FiscalPeriodStatus" AS ENUM ('OPEN', 'CLOSED');

CREATE TABLE "FiscalPeriod" (
  "id" text NOT NULL,
  "tenantId" text NOT NULL,
  "name" text NOT NULL,
  "periodStart" timestamp(3) NOT NULL,
  "periodEnd" timestamp(3) NOT NULL,
  "status" "FiscalPeriodStatus" NOT NULL DEFAULT 'OPEN',
  "closedAt" timestamp(3),
  "closedById" text,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL,
  CONSTRAINT "FiscalPeriod_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FiscalPeriod_date_range_check" CHECK ("periodStart" < "periodEnd")
);

CREATE UNIQUE INDEX "FiscalPeriod_tenantId_name_key" ON "FiscalPeriod"("tenantId","name");
CREATE INDEX "FiscalPeriod_tenantId_status_periodStart_periodEnd_idx"
  ON "FiscalPeriod"("tenantId","status","periodStart","periodEnd");

ALTER TABLE "FiscalPeriod"
  ADD CONSTRAINT "FiscalPeriod_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FiscalPeriod"
  ADD CONSTRAINT "FiscalPeriod_closedById_fkey"
  FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "FiscalPeriod" (
  "id","tenantId","name","periodStart","periodEnd","status","createdAt","updatedAt"
)
SELECT
  'fp-initial-' || md5(t."id"),
  t."id",
  'INITIAL',
  TIMESTAMP '2000-01-01 00:00:00',
  TIMESTAMP '2099-12-31 23:59:59.999',
  'OPEN'::"FiscalPeriodStatus",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Tenant" t
WHERE NOT EXISTS (
  SELECT 1 FROM "FiscalPeriod" fp WHERE fp."tenantId" = t."id"
);

ALTER TABLE "JournalEntry" ADD COLUMN "fiscalPeriodId" text;

UPDATE "JournalEntry" je
SET "fiscalPeriodId" = fp."id"
FROM "FiscalPeriod" fp
WHERE fp."tenantId" = je."tenantId"
  AND je."entryDate" >= fp."periodStart"
  AND je."entryDate" <= fp."periodEnd";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "JournalEntry" WHERE "fiscalPeriodId" IS NULL) THEN
    RAISE EXCEPTION 'Unable to backfill fiscalPeriodId for all journal entries';
  END IF;
END $$;

ALTER TABLE "JournalEntry"
  ALTER COLUMN "fiscalPeriodId" SET NOT NULL;

ALTER TABLE "JournalEntry"
  ADD CONSTRAINT "JournalEntry_fiscalPeriodId_fkey"
  FOREIGN KEY ("fiscalPeriodId") REFERENCES "FiscalPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "JournalEntry_tenantId_fiscalPeriodId_entryDate_idx"
  ON "JournalEntry"("tenantId","fiscalPeriodId","entryDate");

ALTER TABLE "JournalEntry" ADD COLUMN "reversalOfId" text;

CREATE UNIQUE INDEX "JournalEntry_reversalOfId_key" ON "JournalEntry"("reversalOfId");

ALTER TABLE "JournalEntry"
  ADD CONSTRAINT "JournalEntry_reversalOfId_fkey"
  FOREIGN KEY ("reversalOfId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FiscalPeriod" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FiscalPeriod" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "FiscalPeriod";
CREATE POLICY tenant_isolation ON "FiscalPeriod"
  USING (app.tenant_visible("tenantId"))
  WITH CHECK (app.tenant_visible("tenantId"));
