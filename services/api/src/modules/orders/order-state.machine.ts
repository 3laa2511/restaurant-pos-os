import { OrderStatus } from './order-status.js';

export type OrderAction =
  | 'CONFIRM'
  | 'SEND_TO_KITCHEN'
  | 'START_PREPARING'
  | 'MARK_READY'
  | 'ASSIGN_DRIVER'
  | 'START_DELIVERY'
  | 'MARK_DELIVERED'
  | 'CLOSE'
  | 'CANCEL'
  | 'VOID'
  | 'REFUND';

const transitions: Record<OrderStatus, Partial<Record<OrderAction, OrderStatus>>> = {
  [OrderStatus.DRAFT]: {
    CONFIRM: OrderStatus.CONFIRMED,
    CANCEL: OrderStatus.CANCELLED,
  },
  [OrderStatus.CONFIRMED]: {
    SEND_TO_KITCHEN: OrderStatus.SENT_TO_KITCHEN,
    CANCEL: OrderStatus.CANCELLED,
  },
  [OrderStatus.SENT_TO_KITCHEN]: {
    START_PREPARING: OrderStatus.PREPARING,
    CANCEL: OrderStatus.CANCELLED,
  },
  [OrderStatus.PREPARING]: {
    MARK_READY: OrderStatus.READY,
  },
  [OrderStatus.READY]: {
    ASSIGN_DRIVER: OrderStatus.ASSIGNED,
    CLOSE: OrderStatus.CLOSED,
  },
  [OrderStatus.ASSIGNED]: {
    START_DELIVERY: OrderStatus.OUT_FOR_DELIVERY,
  },
  [OrderStatus.OUT_FOR_DELIVERY]: {
    MARK_DELIVERED: OrderStatus.DELIVERED,
  },
  [OrderStatus.DELIVERED]: {
    CLOSE: OrderStatus.CLOSED,
  },
  [OrderStatus.CLOSED]: {
    REFUND: OrderStatus.REFUNDED,
  },
  [OrderStatus.CANCELLED]: {
    REFUND: OrderStatus.REFUNDED,
  },
  [OrderStatus.VOIDED]: {},
  [OrderStatus.REFUNDED]: {},
  [OrderStatus.FAILED]: {},
};

export function canTransition(status: OrderStatus, action: OrderAction): boolean {
  return transitions[status][action] !== undefined;
}

export function transition(status: OrderStatus, action: OrderAction): OrderStatus {
  const next = transitions[status][action];
  if (!next) {
    throw new Error(`Invalid order transition: ${status} -> ${action}`);
  }
  return next;
}
