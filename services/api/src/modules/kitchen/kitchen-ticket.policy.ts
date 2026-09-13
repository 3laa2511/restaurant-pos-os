export type KitchenTicketStatus =
  | 'SENT_TO_KITCHEN'
  | 'PREPARING'
  | 'READY'
  | 'COMPLETED'
  | 'CANCELLED';

const transitions: Record<KitchenTicketStatus, readonly KitchenTicketStatus[]> = {
  SENT_TO_KITCHEN: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransitionKitchenTicket(
  from: KitchenTicketStatus,
  to: KitchenTicketStatus,
): boolean {
  return transitions[from].includes(to);
}

export function assertKitchenTicketTransition(
  from: KitchenTicketStatus,
  to: KitchenTicketStatus,
): void {
  if (!canTransitionKitchenTicket(from, to)) {
    throw new Error(`Invalid kitchen ticket transition: ${from} -> ${to}`);
  }
}
