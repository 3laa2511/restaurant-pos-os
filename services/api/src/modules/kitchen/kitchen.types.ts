import { canTransitionKitchenTicket, type KitchenTicketStatus as PolicyKitchenTicketStatus } from './kitchen-ticket.policy.js';

export enum KitchenStationType {
  KITCHEN = 'KITCHEN',
  BEVERAGE = 'BEVERAGE',
  PACKING = 'PACKING',
}

/**
 * Kitchen lifecycle is owned by kitchen-ticket.policy.ts.
 * Keep this enum as a typed boundary for consumers that need an enum value.
 */
export enum KitchenTicketStatus {
  SENT_TO_KITCHEN = 'SENT_TO_KITCHEN',
  PREPARING = 'PREPARING',
  READY = 'READY',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export interface KitchenTicketItem {
  orderItemId: string;
  productNameSnapshot: string;
  quantity: number;
  modifiers: readonly string[];
  note?: string | null;
}

export interface KitchenTicket {
  id: string;
  orderId: string;
  branchId: string;
  station: KitchenStationType;
  status: KitchenTicketStatus;
  items: readonly KitchenTicketItem[];
  createdAt: Date;
}

/**
 * Compatibility helper for callers that still use the legacy type boundary.
 * The policy module remains the single source of truth for transitions.
 */
export function canMoveTicket(
  status: KitchenTicketStatus,
  next: KitchenTicketStatus,
): boolean {
  return canTransitionKitchenTicket(
    status as PolicyKitchenTicketStatus,
    next as PolicyKitchenTicketStatus,
  );
}
