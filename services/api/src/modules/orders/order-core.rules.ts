import { OrderStatus } from './order-status.js';
import { canTransition, OrderAction } from './order-state.machine.js';

export function assertTransition(status: OrderStatus, action: OrderAction): void {
  if (!canTransition(status, action)) {
    throw new Error(`Order action ${action} is not allowed while status is ${status}`);
  }
}

export function canModifyIssuedItems(status: OrderStatus): boolean {
  return status === OrderStatus.DRAFT || status === OrderStatus.CONFIRMED;
}

export function requiresAuthorizedCancellation(status: OrderStatus): boolean {
  return ![
    OrderStatus.DRAFT,
    OrderStatus.CONFIRMED,
  ].includes(status);
}

export function requiresRefund(status: OrderStatus): boolean {
  return status === OrderStatus.CLOSED || status === OrderStatus.CANCELLED;
}
