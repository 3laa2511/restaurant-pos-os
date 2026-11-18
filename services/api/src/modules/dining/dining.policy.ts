import type { DiningTableStatus, OrderStatus } from '../../generated/prisma/enums.js';

const ASSIGNABLE_ORDER_STATUSES: readonly OrderStatus[] = [
  'DRAFT', 'CONFIRMED', 'SENT_TO_KITCHEN', 'PREPARING', 'READY',
];
const TERMINAL_ORDER_STATUSES: readonly OrderStatus[] = ['CLOSED', 'CANCELLED', 'VOIDED', 'REFUNDED'];

const TABLE_TRANSITIONS: Record<DiningTableStatus, readonly DiningTableStatus[]> = {
  AVAILABLE: ['RESERVED', 'OUT_OF_SERVICE'],
  RESERVED: ['AVAILABLE', 'OUT_OF_SERVICE'],
  OCCUPIED: [],
  CLEANING: ['AVAILABLE', 'OUT_OF_SERVICE'],
  OUT_OF_SERVICE: ['AVAILABLE'],
};

export function isAssignableDiningOrderStatus(status: OrderStatus): boolean {
  return ASSIGNABLE_ORDER_STATUSES.includes(status);
}

export function isTerminalDiningOrderStatus(status: OrderStatus): boolean {
  return TERMINAL_ORDER_STATUSES.includes(status);
}

export function canTransitionDiningTableStatus(from: DiningTableStatus, to: DiningTableStatus): boolean {
  return TABLE_TRANSITIONS[from].includes(to);
}
