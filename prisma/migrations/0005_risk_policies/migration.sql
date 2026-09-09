CREATE TABLE "RiskPolicy" (
  "id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "branchId" TEXT,
  "baseScore" INTEGER NOT NULL,
  "amountThreshold" DECIMAL(12,2),
  "varianceThreshold" DECIMAL(12,2),
  "requiresReason" BOOLEAN NOT NULL DEFAULT false,
  "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
  "approvalPermission" TEXT,
  "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "effectiveTo" TIMESTAMP(3),
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RiskPolicy_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RiskPolicy_action_branchId_enabled_idx" ON "RiskPolicy"("action", "branchId", "enabled");
CREATE INDEX "RiskPolicy_effectiveFrom_effectiveTo_idx" ON "RiskPolicy"("effectiveFrom", "effectiveTo");
CREATE INDEX "RiskPolicy_branchId_idx" ON "RiskPolicy"("branchId");

ALTER TABLE "RiskPolicy" ADD CONSTRAINT "RiskPolicy_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "RiskPolicy" (
  "id", "action", "baseScore", "requiresReason", "requiresApproval", "approvalPermission", "effectiveFrom", "enabled", "createdAt", "updatedAt"
)
VALUES
  ('risk-payment-voided', 'PAYMENT_VOIDED', 80, true, true, 'payment.void', CURRENT_TIMESTAMP, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('risk-payment-refunded', 'PAYMENT_REFUNDED', 70, true, false, NULL, CURRENT_TIMESTAMP, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('risk-order-voided', 'ORDER_VOIDED', 75, true, true, 'order.cancel', CURRENT_TIMESTAMP, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('risk-order-cancelled', 'ORDER_CANCELLED', 60, true, false, NULL, CURRENT_TIMESTAMP, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('risk-order-item-voided', 'ORDER_ITEM_VOIDED', 65, true, false, NULL, CURRENT_TIMESTAMP, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('risk-discount-applied', 'DISCOUNT_APPLIED', 45, false, false, NULL, CURRENT_TIMESTAMP, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('risk-cash-drawer-adjusted', 'CASH_DRAWER_ADJUSTED', 70, true, true, 'cash_drawer.manage', CURRENT_TIMESTAMP, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('risk-cash-drawer-pay-out', 'CASH_DRAWER_PAY_OUT', 60, true, false, NULL, CURRENT_TIMESTAMP, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('risk-cash-drawer-pay-in', 'CASH_DRAWER_PAY_IN', 35, true, false, NULL, CURRENT_TIMESTAMP, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('risk-shift-closed', 'SHIFT_CLOSED', 40, false, false, NULL, CURRENT_TIMESTAMP, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('risk-shift-variance', 'SHIFT_VARIANCE', 65, true, false, NULL, CURRENT_TIMESTAMP, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('risk-user-role-changed', 'USER_ROLE_CHANGED', 90, true, true, 'user.manage', CURRENT_TIMESTAMP, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('risk-user-disabled', 'USER_DISABLED', 85, true, true, 'user.manage', CURRENT_TIMESTAMP, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('risk-device-blocked', 'DEVICE_BLOCKED', 95, true, true, 'user.manage', CURRENT_TIMESTAMP, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('risk-offline-checkout-applied', 'OFFLINE_CHECKOUT_APPLIED', 20, false, false, NULL, CURRENT_TIMESTAMP, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
