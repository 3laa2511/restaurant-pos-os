export const ORDER_EVENTS = {
  CREATED: 'ORDER_CREATED',
  CONFIRMED: 'ORDER_CONFIRMED',
  SENT_TO_KITCHEN: 'ORDER_SENT_TO_KITCHEN',
  PREPARING: 'ORDER_PREPARING',
  READY: 'ORDER_READY',
  DRIVER_ASSIGNED: 'DRIVER_ASSIGNED',
  OUT_FOR_DELIVERY: 'ORDER_OUT_FOR_DELIVERY',
  DELIVERED: 'ORDER_DELIVERED',
  CLOSED: 'ORDER_CLOSED',
  CANCELLED: 'ORDER_CANCELLED',
  VOIDED: 'ORDER_VOIDED',
  REFUNDED: 'ORDER_REFUNDED',
  ITEM_ADDED: 'ORDER_ITEM_ADDED',
  ITEM_VOIDED: 'ORDER_ITEM_VOIDED',
} as const;

export type OrderEventType = (typeof ORDER_EVENTS)[keyof typeof ORDER_EVENTS];

export interface OrderEventEnvelope<TPayload = Record<string, unknown>> {
  eventId: string;
  orderId: string;
  branchId: string;
  actorUserId: string | null;
  deviceId: string | null;
  type: OrderEventType;
  version: number;
  occurredAt: Date;
  payload: TPayload;
}
