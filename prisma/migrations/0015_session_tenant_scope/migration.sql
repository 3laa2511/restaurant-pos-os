-- Persist tenant scope directly on sessions so central users remain tenant-scoped
-- even when branchId is NULL.
ALTER TABLE "Session" ADD COLUMN "tenantId" TEXT;

UPDATE "Session" s
SET "tenantId" = u."tenantId"
FROM "User" u
WHERE s."userId" = u."id"
  AND s."tenantId" IS NULL;

ALTER TABLE "Session" ALTER COLUMN "tenantId" SET NOT NULL;

ALTER TABLE "Session"
  ADD CONSTRAINT "Session_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Session_tenantId_revokedAt_idx"
  ON "Session"("tenantId","revokedAt");

CREATE OR REPLACE FUNCTION "enforce_session_tenant_consistency"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  user_tenant TEXT;
  branch_tenant TEXT;
BEGIN
  SELECT "tenantId" INTO user_tenant FROM "User" WHERE "id" = NEW."userId";
  IF user_tenant IS NULL OR user_tenant <> NEW."tenantId" THEN
    RAISE EXCEPTION 'SESSION_USER_TENANT_MISMATCH';
  END IF;

  IF NEW."branchId" IS NOT NULL THEN
    SELECT "tenantId" INTO branch_tenant FROM "Branch" WHERE "id" = NEW."branchId";
    IF branch_tenant IS NULL OR branch_tenant <> NEW."tenantId" THEN
      RAISE EXCEPTION 'SESSION_BRANCH_TENANT_MISMATCH';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "Session_tenant_consistency"
BEFORE INSERT OR UPDATE OF "userId","tenantId","branchId"
ON "Session" FOR EACH ROW EXECUTE FUNCTION "enforce_session_tenant_consistency"();
