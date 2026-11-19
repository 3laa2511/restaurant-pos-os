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

export type DiningClearKitchenAction = 'CANCEL' | 'KEEP' | 'BLOCK';

/**
 * When an order is already terminal, unfinished kitchen work must not remain
 * silently active. READY tickets require an explicit kitchen resolution because
 * the kitchen lifecycle intentionally does not allow READY -> CANCELLED.
 */
export function diningClearKitchenAction(status: string): DiningClearKitchenAction {
  if (status === 'SENT_TO_KITCHEN' || status === 'PREPARING') return 'CANCEL';
  if (status === 'READY') return 'BLOCK';
  if (status === 'COMPLETED' || status === 'CANCELLED') return 'KEEP';
  return 'BLOCK';
}
