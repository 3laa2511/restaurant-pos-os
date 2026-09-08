import type { AuditRiskDecision } from './audit-risk.policy.js';

export type AuditAction =
  | 'PAYMENT_REFUNDED'
  | 'PAYMENT_VOIDED'
  | 'DISCOUNT_APPLIED'
  | 'PRICE_OVERRIDE'
  | 'CASH_DRAWER_ADJUSTED'
  | 'SHIFT_CLOSED'
  | 'OFFLINE_CHECKOUT_APPLIED';

export interface AuditEvent {
  id: string;
  branchId: string;
  actorId: string;
  deviceId?: string | null;
  shiftId?: string | null;
  action: AuditAction | string;
  entityType: string;
  entityId: string;
  operationId?: string | null;
  reason?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  risk?: AuditRiskDecision | null;
  occurredAt: Date;
}

export function createAuditEvent(input: Omit<AuditEvent, 'occurredAt'>): AuditEvent {
  if (!input.actorId.trim() || !input.action.trim() || !input.entityId.trim()) {
    throw new Error('Audit actor, action and entity are required');
  }
  if (!input.branchId.trim()) {
    throw new Error('Audit branch is required');
  }
  if (input.reason !== undefined && input.reason !== null && !input.reason.trim()) {
    throw new Error('Audit reason cannot be blank');
  }
  return { ...input, occurredAt: new Date() };
}
