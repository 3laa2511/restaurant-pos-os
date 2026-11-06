import { describe, expect, it } from '@jest/globals';
import type { AuthContext } from './authorization.types.js';
import { resolveBranchScope } from './authorization.types.js';

function context(branchId: string | null): AuthContext {
  return {
    userId: 'user-1',
    tenantId: 'tenant-1',
    branchId,
    deviceId: null,
    sessionId: 'session-1',
    workspace: 'HR',
    roles: ['HR_MANAGER'],
    permissions: [],
  };
}

describe('resolveBranchScope', () => {
  it('uses the authenticated branch when the client omits a branch filter', () => {
    expect(resolveBranchScope(context('branch-a'))).toBe('branch-a');
  });

  it('allows a branch-scoped client to repeat its own branch only', () => {
    expect(resolveBranchScope(context('branch-a'), 'branch-a')).toBe('branch-a');
    expect(() => resolveBranchScope(context('branch-a'), 'branch-b')).toThrow('branch access denied');
  });

  it('allows tenant-wide sessions to remain tenant-wide or narrow to a branch', () => {
    expect(resolveBranchScope(context(null))).toBeUndefined();
    expect(resolveBranchScope(context(null), 'branch-a')).toBe('branch-a');
  });
});
