import { describe, expect, it, beforeEach } from 'vitest';
import { getPosRuntimeIdentity } from './runtime-identity.js';

describe('getPosRuntimeIdentity', () => {
  beforeEach(() => sessionStorage.clear());

  it('maps the authenticated session to the POS runtime scope', () => {
    const session = {
      accessToken: 'token', expiresAt: new Date(Date.now() + 60_000).toISOString(),
      user: { id: 'user-1', username: 'cashier', displayName: 'Cashier One', branchId: 'branch-1', roles: ['CASHIER'], permissions: ['order.create'] },
      deviceId: 'device-1',
    };
    sessionStorage.setItem('pos_session', JSON.stringify(session));
    expect(getPosRuntimeIdentity()).toMatchObject({ userId: 'user-1', cashierId: 'user-1', branchId: 'branch-1', deviceId: 'device-1' });
  });

  it('fails closed when the authenticated session has no branch or device', () => {
    const session = {
      accessToken: 'token', expiresAt: new Date(Date.now() + 60_000).toISOString(),
      user: { id: 'user-1', username: 'cashier', displayName: 'Cashier One', branchId: null, roles: ['CASHIER'], permissions: [] },
      deviceId: null,
    };
    sessionStorage.setItem('pos_session', JSON.stringify(session));
    expect(() => getPosRuntimeIdentity()).toThrow('Authenticated session is not assigned to a branch');
  });
});
