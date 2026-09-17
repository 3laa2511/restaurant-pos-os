import { describe, expect, it } from '@jest/globals';
import { InMemoryOrderRepository } from './in-memory-order-repository.js';
import { OrderService } from './order.service.js';
import { PERMISSIONS } from '../auth/rbac.constants.js';
import type { AuthContext } from '../auth/authorization.types.js';

const context: AuthContext = {
  userId: 'user-1',
  tenantId: 'tenant-1',
  branchId: 'BR01',
  deviceId: 'POS01',
  roles: ['CASHIER'],
  permissions: [PERMISSIONS.ORDER_CREATE, PERMISSIONS.ORDER_VIEW, PERMISSIONS.ORDER_CONFIRM],
};

function writers() {
  return {
    events: { append: async () => undefined },
    audits: { append: async () => undefined },
  };
}

describe('OrderService', () => {
  it('creates a draft order and emits event/audit records', async () => {
    const repository = new InMemoryOrderRepository();
    const events: unknown[] = [];
    const audits: unknown[] = [];
    const service = new OrderService(
      repository,
      { append: async (event) => { events.push(event); } },
      { append: async (audit) => { audits.push(audit); } },
    );

    const order = await service.create(context, {
      branchId: 'BR01',
      createdById: 'user-1',
      source: 'POS',
      type: 'TAKEAWAY',
      total: '120.00',
      idempotencyKey: '0123456789abcdef',
    });

    expect(order.status).toBe('DRAFT');
    expect(order.version).toBe(1);
    expect(order.tenantId).toBe('tenant-1');
    expect(events).toHaveLength(1);
    expect(audits).toHaveLength(1);
  });

  it('rejects creation outside the authenticated branch', async () => {
    const service = new OrderService(
      new InMemoryOrderRepository(),
      { append: async () => undefined },
      { append: async () => undefined },
    );

    await expect(
      service.create(context, {
        branchId: 'BR02',
        createdById: 'user-1',
        source: 'POS',
        type: 'TAKEAWAY',
        total: '50.00',
        idempotencyKey: '0123456789abcdef',
      }),
    ).rejects.toThrow('branch access denied');
  });

  it('denies tenantless sessions before reading orders', async () => {
    const repository = new InMemoryOrderRepository();
    const service = new OrderService(repository, writers().events, writers().audits);
    const tenantless = { ...context, tenantId: null, branchId: null } satisfies AuthContext;

    await expect(service.findById(tenantless, 'order-1')).rejects.toThrow('tenant scope is required');
  });

  it('cannot read or transition an order owned by another tenant', async () => {
    const repository = new InMemoryOrderRepository();
    const service = new OrderService(repository, writers().events, writers().audits);
    await repository.create({
      id: 'order-tenant-2',
      orderNumber: 'BR02-1',
      branchId: 'BR02',
      tenantId: 'tenant-2',
      createdById: 'user-2',
      source: 'POS',
      type: 'TAKEAWAY',
      status: 'DRAFT',
      total: '25.00',
    });

    expect(await service.findById(context, 'order-tenant-2')).toBeNull();
    await expect(
      service.transition(context, 'order-tenant-2', 1, 'CONFIRMED'),
    ).rejects.toThrow('Order not found');
  });
});
