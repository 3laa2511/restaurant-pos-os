-- Accounting hardening is idempotent because the canonical 0017 migration already creates
-- the full account tree and journal status columns. Keep this migration safe for databases
-- that were initialized from an earlier 0017 variant.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'AccountingAccount' AND column_name = 'parentId'
  ) THEN
    ALTER TABLE "AccountingAccount" ADD COLUMN "parentId" TEXT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'AccountingAccount' AND column_name = 'allowPosting'
  ) THEN
    ALTER TABLE "AccountingAccount" ADD COLUMN "allowPosting" BOOLEAN NOT NULL DEFAULT TRUE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'AccountingAccount_parentId_fkey'
  ) THEN
    ALTER TABLE "AccountingAccount"
      ADD CONSTRAINT "AccountingAccount_parentId_fkey"
      FOREIGN KEY ("parentId") REFERENCES "AccountingAccount"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "AccountingAccount_tenant_parent_idx"
  ON "AccountingAccount"("tenantId","parentId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'JournalEntryStatus') THEN
    CREATE TYPE "JournalEntryStatus" AS ENUM ('POSTED','VOIDED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'JournalEntry' AND column_name = 'status'
  ) THEN
    ALTER TABLE "JournalEntry"
      ADD COLUMN "status" "JournalEntryStatus" NOT NULL DEFAULT 'POSTED';
  END IF;
END $$;

ALTER TABLE "JournalEntry" ALTER COLUMN "sourceType" DROP NOT NULL;
ALTER TABLE "JournalEntry" ALTER COLUMN "sourceId" DROP NOT NULL;

CREATE INDEX IF NOT EXISTS "JournalEntry_tenant_status_postedAt_idx"
  ON "JournalEntry"("tenantId","status","postedAt");
