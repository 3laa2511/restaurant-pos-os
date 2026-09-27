ALTER TABLE "AccountingAccount" ADD COLUMN "parentId" TEXT;
ALTER TABLE "AccountingAccount" ADD COLUMN "allowPosting" BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE "AccountingAccount" ADD CONSTRAINT "AccountingAccount_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "AccountingAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "AccountingAccount_tenant_parent_idx" ON "AccountingAccount"("tenantId","parentId");
ALTER TABLE "JournalEntry" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'POSTED';
ALTER TABLE "JournalEntry" ALTER COLUMN "sourceType" DROP NOT NULL;
ALTER TABLE "JournalEntry" ALTER COLUMN "sourceId" DROP NOT NULL;
CREATE INDEX "JournalEntry_tenant_status_postedAt_idx" ON "JournalEntry"("tenantId","status","postedAt");