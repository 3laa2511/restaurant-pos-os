import { OrderStatus } from '../../generated/prisma/enums.js';
import type { KitchenTicketStatus } from './kitchen-ticket.policy.js';

const FORWARD_ORDER_STATUS: Readonly<Record<'SENT_TO_KITCHEN' | 'PREPARING' | 'READY' | 'CLOSED', number>> = {
  SENT_TO_KITCHEN: 1,
  PREPARING: 2,
  READY: 3,
  CLOSED: 4,
};

export function deriveOrderStatusFromKitchenTickets(
  statuses: readonly KitchenTicketStatus[],
): Extract<OrderStatus, 'SENT_TO_KITCHEN' | 'PREPARING' | 'READY' | 'CLOSED' | 'CANCELLED'> {
  if (statuses.length === 0) throw new Error('Cannot project order status without kitchen tickets');

  const active = statuses.filter((status) => status !== 'CANCELLED' && status !== 'COMPLETED');
  if (active.length === 0) {
    return statuses.every((status) => status === 'CANCELLED') ? OrderStatus.CANCELLED : OrderStatus.CLOSED;
  }
  if (active.some((status) => status === 'PREPARING')) return OrderStatus.PREPARING;
  if (active.some((status) => status === 'SENT_TO_KITCHEN')) return OrderStatus.SENT_TO_KITCHEN;
  return OrderStatus.READY;
}

export function shouldAdvanceOrderStatus(current: OrderStatus, projected: OrderStatus): boolean {
  const currentRank = FORWARD_ORDER_STATUS[current as keyof typeof FORWARD_ORDER_STATUS];
  const projectedRank = FORWARD_ORDER_STATUS[projected as keyof typeof FORWARD_ORDER_STATUS];

  if (current === projected) return false;
  if (projected === OrderStatus.CANCELLED) {
    return current === OrderStatus.SENT_TO_KITCHEN || current === OrderStatus.PREPARING || current === OrderStatus.READY;
  }
  if (current === OrderStatus.CANCELLED || current === OrderStatus.CLOSED) return false;
  if (projectedRank === undefined) return false;
  if (currentRank === undefined) return current === OrderStatus.CONFIRMED;
  return projectedRank > currentRank;
}
