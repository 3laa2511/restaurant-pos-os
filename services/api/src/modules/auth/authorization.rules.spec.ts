import { describe, expect, it } from '@jest/globals';
import { permissionsForRole, roleHasPermission } from './authorization.rules.js';
import { PERMISSIONS, ROLE_CODES } from './rbac.constants.js';

describe('authorization rules', () => {
  it('does not grant cashiers refund or void permissions', () => {
    expect(roleHasPermission(ROLE_CODES.CASHIER, PERMISSIONS.PAYMENT_REFUND)).toBe(false);
    expect(roleHasPermission(ROLE_CODES.CASHIER, PERMISSIONS.PAYMENT_VOID)).toBe(false);
  });

  it('grants refund and void permissions to branch managers', () => {
    expect(roleHasPermission(ROLE_CODES.BRANCH_MANAGER, PERMISSIONS.PAYMENT_REFUND)).toBe(true);
    expect(roleHasPermission(ROLE_CODES.BRANCH_MANAGER, PERMISSIONS.PAYMENT_VOID)).toBe(true);
  });

  it('keeps refund and void as distinct permissions', () => {
    const permissions = permissionsForRole(ROLE_CODES.CALL_CENTER_SUPERVISOR);
    expect(permissions).toContain(PERMISSIONS.PAYMENT_REFUND);
    expect(permissions).toContain(PERMISSIONS.PAYMENT_VOID);
    expect(PERMISSIONS.PAYMENT_REFUND).not.toBe(PERMISSIONS.PAYMENT_VOID);
  });

  it('grants kitchen operators the persisted ticket lifecycle permission', () => {
    expect(roleHasPermission(ROLE_CODES.KITCHEN, PERMISSIONS.KITCHEN_TICKET_MANAGE)).toBe(true);
  });
});
