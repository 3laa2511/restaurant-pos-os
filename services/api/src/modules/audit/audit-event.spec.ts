import { describe, expect, it } from '@jest/globals';
import { createAuditEvent } from './audit-event.js';

describe('createAuditEvent', () => {
  it('captures actor, device, shift, operation and before/after snapshots', () => {
    const event = createAuditEvent({
      id: 'audit-1',
      branchId: 'branch-1',
      actorId: 'cashier-1',
      deviceId: 'device-1',
      shiftId: 'shift-1',
      operationId: 'operation-1',
      action: 'PAYMENT_REFUNDED',
      entityType: 'PAYMENT',
      entityId: 'payment-1',
      reason: 'Customer returned the order',
      before: { status: 'PAID', refunded: 0 },
      after: { status: 'PARTIALLY_REFUNDED', refunded: 25 },
      risk: {
        level: 'MEDIUM',
        score: 35,
        requiresReason: true,
        requiresManagerApproval: false,
      },
    });

    expect(event).toMatchObject({
      branchId: 'branch-1',
      actorId: 'cashier-1',
      deviceId: 'device-1',
      shiftId: 'shift-1',
      operationId: 'operation-1',
      action: 'PAYMENT_REFUNDED',
      before: { status: 'PAID', refunded: 0 },
      after: { status: 'PARTIALLY_REFUNDED', refunded: 25 },
      risk: { level: 'MEDIUM', score: 35 },
    });
    expect(event.occurredAt).toBeInstanceOf(Date);
  });

  it('rejects missing branch identity', () => {
    expect(() =>
      createAuditEvent({
        id: 'audit-2',
        branchId: '   ',
        actorId: 'cashier-1',
        action: 'PAYMENT_VOIDED',
        entityType: 'PAYMENT',
        entityId: 'payment-1',
      }),
    ).toThrow('Audit branch is required');
  });

  it('rejects a blank reason when supplied', () => {
    expect(() =>
      createAuditEvent({
        id: 'audit-3',
        branchId: 'branch-1',
        actorId: 'cashier-1',
        action: 'CASH_DRAWER_ADJUSTED',
        entityType: 'CASH_DRAWER',
        entityId: 'drawer-1',
        reason: '   ',
      }),
    ).toThrow('Audit reason cannot be blank');
  });
});
