-- Phase 5: RiskPolicy must have an explicit tenant owner.
-- A nullable branchId cannot establish ownership for central policies.
-- Existing branch policies inherit their tenant from Branch. Existing central
-- policies are copied once per existing tenant, then the unowned originals are
-- removed. On an empty database the legacy global rows are simply removed;
-- RiskPolicyService has a safe built-in fallback until tenant defaults are seeded.
ALTER TABLE "RiskPolicy" ADD COLUMN "tenantId" TEXT;

UPDATE "RiskPolicy" rp
SET "tenantId" = b."tenantId"
FROM "Branch" b
WHERE rp."branchId" = b."id"
  AND rp."tenantId" IS NULL;

INSERT INTO "RiskPolicy" (
  "id", "tenantId", "action", "branchId", "baseScore",
  "amountThreshold", "varianceThreshold", "requiresReason",
  "requiresApproval", "approvalPermission", "effectiveFrom",
  "effectiveTo", "enabled", "createdAt", "updatedAt"
)
SELECT
  rp."id" || ':' || t."id",
  t."id",
  rp."action",
  NULL,
  rp."baseScore",
  rp."amountThreshold",
  rp."varianceThreshold",
  rp."requiresReason",
  rp."requiresApproval",
  rp."approvalPermission",
  rp."effectiveFrom",
  rp."effectiveTo",
  rp."enabled",
  rp."createdAt",
  rp."updatedAt"
FROM "RiskPolicy" rp
CROSS JOIN "Tenant" t
WHERE rp."tenantId" IS NULL;

DELETE FROM "RiskPolicy" WHERE "tenantId" IS NULL;

ALTER TABLE "RiskPolicy" ALTER COLUMN "tenantId" SET NOT NULL;

ALTER TABLE "RiskPolicy"
  ADD CONSTRAINT "RiskPolicy_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

DROP INDEX IF EXISTS "RiskPolicy_action_branchId_enabled_idx";
DROP INDEX IF EXISTS "RiskPolicy_effectiveFrom_effectiveTo_idx";

CREATE INDEX "RiskPolicy_tenantId_action_branchId_enabled_idx"
  ON "RiskPolicy"("tenantId", "action", "branchId", "enabled");

CREATE INDEX "RiskPolicy_tenantId_effectiveFrom_effectiveTo_idx"
  ON "RiskPolicy"("tenantId", "effectiveFrom", "effectiveTo");

DROP POLICY IF EXISTS tenant_isolation ON "RiskPolicy";
CREATE POLICY tenant_isolation ON "RiskPolicy"
  USING (
    app.tenant_visible("tenantId")
    AND app.branch_visible("branchId")
  )
  WITH CHECK (
    app.tenant_visible("tenantId")
    AND app.branch_visible("branchId")
  );
