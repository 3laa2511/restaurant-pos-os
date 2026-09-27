CREATE TYPE "AccountingAccountType" AS ENUM ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE');
CREATE TABLE "AccountingAccount" ("id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT,"code" TEXT NOT NULL,"name" TEXT NOT NULL,"nameAr" TEXT,"type" "AccountingAccountType" NOT NULL,"active" BOOLEAN NOT NULL DEFAULT TRUE,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "AccountingAccount_tenant_code_key" UNIQUE ("tenantId","code"));
CREATE INDEX "AccountingAccount_tenant_type_active_idx" ON "AccountingAccount"("tenantId","type","active");
CREATE TABLE "JournalEntry" ("id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT,"entryNumber" TEXT NOT NULL,"description" TEXT NOT NULL,"sourceType" TEXT NOT NULL,"sourceId" TEXT NOT NULL,"branchId" TEXT REFERENCES "Branch"("id") ON DELETE RESTRICT,"postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "JournalEntry_tenant_entryNumber_key" UNIQUE ("tenantId","entryNumber"),CONSTRAINT "JournalEntry_tenant_source_key" UNIQUE ("tenantId","sourceType","sourceId"));
CREATE INDEX "JournalEntry_tenant_branch_postedAt_idx" ON "JournalEntry"("tenantId","branchId","postedAt");
CREATE TABLE "JournalLine" ("id" TEXT PRIMARY KEY,"entryId" TEXT NOT NULL REFERENCES "JournalEntry"("id") ON DELETE CASCADE,"accountId" TEXT NOT NULL REFERENCES "AccountingAccount"("id") ON DELETE RESTRICT,"branchId" TEXT REFERENCES "Branch"("id") ON DELETE RESTRICT,"debit" DECIMAL(14,2) NOT NULL DEFAULT 0,"credit" DECIMAL(14,2) NOT NULL DEFAULT 0,"memo" TEXT,CONSTRAINT "JournalLine_one_side_check" CHECK (("debit" >= 0 AND "credit" = 0) OR ("credit" >= 0 AND "debit" = 0)));
CREATE INDEX "JournalLine_entry_idx" ON "JournalLine"("entryId");
CREATE INDEX "JournalLine_account_branch_idx" ON "JournalLine"("accountId","branchId");
CREATE OR REPLACE FUNCTION enforce_journal_line_tenant_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE entry_tenant TEXT; account_tenant TEXT; branch_tenant TEXT;
BEGIN
 SELECT "tenantId" INTO entry_tenant FROM "JournalEntry" WHERE id=NEW."entryId";
 SELECT "tenantId" INTO account_tenant FROM "AccountingAccount" WHERE id=NEW."accountId";
 IF entry_tenant IS NULL OR account_tenant IS DISTINCT FROM entry_tenant THEN RAISE EXCEPTION 'Journal line tenant mismatch'; END IF;
 IF NEW."branchId" IS NOT NULL THEN SELECT "tenantId" INTO branch_tenant FROM "Branch" WHERE id=NEW."branchId"; IF branch_tenant IS DISTINCT FROM entry_tenant THEN RAISE EXCEPTION 'Journal line branch tenant mismatch'; END IF; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER journal_line_tenant_consistency BEFORE INSERT OR UPDATE ON "JournalLine" FOR EACH ROW EXECUTE FUNCTION enforce_journal_line_tenant_consistency();