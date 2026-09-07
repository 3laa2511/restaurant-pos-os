import { describe, expect, it } from '@jest/globals';
import { evaluateAuditRisk } from './audit-risk.policy.js';

describe('evaluateAuditRisk', () => {
  it('requires a reason for every sensitive action', () => {
    expect(() => evaluateAuditRisk({ action: 'PAYMENT_REFUNDED', amount: 10 })).toThrow('A reason is required');
  });

  it('classifies a normal refund as low risk', () => {
    expect(evaluateAuditRisk({ action: 'PAYMENT_REFUNDED', amount: 10, reason: 'Customer returned order' })).toMatchObject({
      level: 'LOW',
      score: 20,
      requiresManagerApproval: false,
    });
  });

  it('requires manager approval for a high-value void', () => {
    expect(evaluateAuditRisk({ action: 'PAYMENT_VOIDED', amount: 500, reason: 'Duplicate payment' })).toMatchObject({
      level: 'HIGH',
      score: 75,
      requiresManagerApproval: true,
    });
  });

  it('raises risk for a material shift variance', () => {
    expect(evaluateAuditRisk({ action: 'SHIFT_CLOSED', variance: -250, reason: 'Cash count mismatch' })).toMatchObject({
      level: 'MEDIUM',
      score: 25,
      requiresManagerApproval: false,
    });
  });

  it('reduces recorded risk after manager approval', () => {
    expect(evaluateAuditRisk({ action: 'PAYMENT_VOIDED', amount: 500, reason: 'Duplicate payment', managerApproved: true })).toMatchObject({
      level: 'HIGH',
      score: 65,
      requiresManagerApproval: true,
    });
  });
});
