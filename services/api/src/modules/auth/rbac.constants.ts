export const ROLE_CODES = {
  CASHIER: 'CASHIER',
  CALL_CENTER_OPERATOR: 'CALL_CENTER_OPERATOR',
  CALL_CENTER_SUPERVISOR: 'CALL_CENTER_SUPERVISOR',
  KITCHEN: 'KITCHEN',
  DISPATCHER: 'DISPATCHER',
  BRANCH_MANAGER: 'BRANCH_MANAGER',
  CENTRAL_ADMIN: 'CENTRAL_ADMIN',
  OWNER: 'OWNER',
} as const;

export const PERMISSIONS = {
  ORDER_CREATE: 'order.create',
  ORDER_VIEW: 'order.view',
  ORDER_CONFIRM: 'order.confirm',
  ORDER_SEND_TO_KITCHEN: 'order.send_to_kitchen',
  ORDER_MODIFY_ISSUED: 'order.modify_issued',
  ORDER_CANCEL: 'order.cancel',
  ORDER_VOID_ITEM: 'order.void_item',
  PAYMENT_CREATE: 'payment.create',
  PAYMENT_REFUND: 'payment.refund',
  SHIFT_OPEN: 'shift.open',
  SHIFT_CLOSE: 'shift.close',
  REPORT_VIEW_OPERATIONAL: 'report.view_operational',
  REPORT_VIEW_FINANCIAL: 'report.view_financial',
  USER_MANAGE: 'user.manage',
  MENU_MANAGE: 'menu.manage',
  INVENTORY_MANAGE: 'inventory.manage',
  DRIVER_ASSIGN: 'driver.assign',
  AUDIT_VIEW: 'audit.view',
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
export type RoleCode = (typeof ROLE_CODES)[keyof typeof ROLE_CODES];
