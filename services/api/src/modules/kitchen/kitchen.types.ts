export enum KitchenStationType {
  KITCHEN = 'KITCHEN',
  BEVERAGE = 'BEVERAGE',
  PACKING = 'PACKING',
}

export enum KitchenTicketStatus {
  QUEUED = 'QUEUED',
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

export function canMoveTicket(status: KitchenTicketStatus, next: KitchenTicketStatus): boolean {
  const transitions: Record<KitchenTicketStatus, readonly KitchenTicketStatus[]> = {
    QUEUED: [KitchenTicketStatus.PREPARING, KitchenTicketStatus.CANCELLED],
    PREPARING: [KitchenTicketStatus.READY, KitchenTicketStatus.CANCELLED],
    READY: [KitchenTicketStatus.COMPLETED],
    COMPLETED: [],
    CANCELLED: [],
  };
  return transitions[status].includes(next);
}
