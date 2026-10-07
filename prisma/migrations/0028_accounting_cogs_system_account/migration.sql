-- Add the system COGS account for every existing tenant.
INSERT INTO "AccountingAccount" ("id", "tenantId", "code", "name", "nameAr", "type", "active", "allowPosting", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  t."id",
  '5100',
  'Cost of Goods Sold',
  'تكلفة البضاعة المباعة',
  'EXPENSE',
  true,
  true,
  NOW(),
  NOW()
FROM "Tenant" t
WHERE NOT EXISTS (
  SELECT 1
  FROM "AccountingAccount" a
  WHERE a."tenantId" = t."id" AND a."code" = '5100'
);