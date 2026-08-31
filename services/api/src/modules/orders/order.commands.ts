import { OrderStatus } from './order-status.js';
import { OrderAction, transition } from './order-state.machine.js';
import { assertTransition } from './order-core.rules.js';
import { assertBranchAccess, assertPermission, AuthContext } from '../auth/authorization.types.js';
import { PERMISSIONS } from '../auth/rbac.constants.js';

export interface OrderAggregate {
  id: string;
  branchId: string;
  status: OrderStatus;
  version: number;
}

const ACTION_PERMISSION: Partial<Record<OrderAction, keyof typeof PERMISSIONS>> = {
  CONFIRM: 'ORDER_CONFIRM',
  SEND_TO_KITCHEN: 'ORDER_SEND_TO_KITCHEN',
  CANCEL: 'ORDER_CANCEL',
  VOID: 'ORDER_VOID_ITEM',
  REFUND: 'PAYMENT_REFUND',
};

export function authorizeOrderAction(
  context: AuthContext,
  order: OrderAggregate,
  action: OrderAction,
): void {
  assertBranchAccess(context, order.branchId);
  const permissionKey = ACTION_PERMISSION[action];
  if (permissionKey) {
    assertPermission(context, PERMISSIONS[permissionKey]);
  }
  assertTransition(order.status, action);
}

export function applyOrderAction(
  context: AuthContext,
  order: OrderAggregate,
  action: OrderAction,
): OrderAggregate {
  authorizeOrderAction(context, order, action);
  return {
    ...order,
    status: transition(order.status, action),
    version: order.version + 1,
  };
}
