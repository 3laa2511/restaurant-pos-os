export type AuditRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type SensitiveAuditAction =
  | 'PAYMENT_REFUNDED'
  | 'PAYMENT_VOIDED'
  | 'DISCOUNT_APPLIED'
  | 'PRICE_OVERRIDE'
  | 'CASH_DRAWER_ADJUSTED'
  | 'SHIFT_CLOSED';

export interface AuditRiskInput {
  action: SensitiveAuditAction;
  amount?: number | null;
  variance?: number | null;
  reason?: string | null;
  managerApproved?: boolean;
}

export interface AuditRiskDecision {
  level: AuditRiskLevel;
  score: number;
  requiresReason: boolean;
  requiresManagerApproval: boolean;
}

const cents = (value: number): number => Math.round((value + Number.EPSILON) * 100);

function absoluteCents(value: number | null | undefined): number {
  if (value === null || value === undefined || !Number.isFinite(value)) return 0;
  return Math.abs(cents(value));
}

export function evaluateAuditRisk(input: AuditRiskInput): AuditRiskDecision {
  const amountCents = absoluteCents(input.amount);
  const varianceCents = absoluteCents(input.variance);
  const reasonPresent = Boolean(input.reason?.trim());

  let score = 0;
  if (input.action === 'PAYMENT_VOIDED') score += 30;
  if (input.action === 'PAYMENT_REFUNDED') score += 20;
  if (input.action === 'CASH_DRAWER_ADJUSTED') score += 25;
  if (input.action === 'PRICE_OVERRIDE') score += 20;
  if (input.action === 'DISCOUNT_APPLIED') score += 15;
  if (input.action === 'SHIFT_CLOSED') score += 10;

  if (amountCents >= 100_000) score += 45;
  else if (amountCents >= 50_000) score += 30;
  else if (amountCents >= 20_000) score += 15;

  if (varianceCents >= 100_000) score += 45;
  else if (varianceCents >= 50_000) score += 30;
  else if (varianceCents >= 20_000) score += 15;

  const requiresReason = true;
  const requiresManagerApproval = score >= 50;
  if (requiresManagerApproval && input.managerApproved) score = Math.max(0, score - 10);

  const level: AuditRiskLevel = score >= 80 ? 'CRITICAL' : score >= 50 ? 'HIGH' : score >= 25 ? 'MEDIUM' : 'LOW';

  if (requiresReason && !reasonPresent) {
    throw new Error(`A reason is required for sensitive action ${input.action}`);
  }

  return { level, score, requiresReason, requiresManagerApproval };
}
