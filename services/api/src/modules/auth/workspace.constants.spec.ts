import { describe, expect, it } from '@jest/globals';
import { PERMISSIONS } from './rbac.constants.js';
import { WORKSPACES, workspaceAllowsPermission } from './workspace.constants.js';

describe('workspace permission boundaries', () => {
  it('does not allow accounting permissions from the POS workspace', () => {
    expect(workspaceAllowsPermission(WORKSPACES.POS, PERMISSIONS.ACCOUNTING_POST)).toBe(false);
    expect(workspaceAllowsPermission(WORKSPACES.POS, PERMISSIONS.ACCOUNTING_MANAGE)).toBe(false);
  });

  it('allows accounting operations only from accounting-scoped workspaces', () => {
    expect(workspaceAllowsPermission(WORKSPACES.ACCOUNTING, PERMISSIONS.ACCOUNTING_POST)).toBe(true);
    expect(workspaceAllowsPermission(WORKSPACES.ACCOUNTING, PERMISSIONS.ACCOUNTING_MANAGE)).toBe(true);
    expect(workspaceAllowsPermission(WORKSPACES.MANAGEMENT, PERMISSIONS.ACCOUNTING_POST)).toBe(false);
  });

  it('keeps payroll permissions available to HR and accounting', () => {
    expect(workspaceAllowsPermission(WORKSPACES.HR, PERMISSIONS.HR_PAYROLL_MANAGE)).toBe(true);
    expect(workspaceAllowsPermission(WORKSPACES.ACCOUNTING, PERMISSIONS.HR_PAYROLL_MANAGE)).toBe(true);
    expect(workspaceAllowsPermission(WORKSPACES.POS, PERMISSIONS.HR_PAYROLL_MANAGE)).toBe(false);
  });

  it('keeps inventory permissions out of POS', () => {
    expect(workspaceAllowsPermission(WORKSPACES.INVENTORY, PERMISSIONS.INVENTORY_ADJUST)).toBe(true);
    expect(workspaceAllowsPermission(WORKSPACES.POS, PERMISSIONS.INVENTORY_ADJUST)).toBe(false);
  });
});
