import type { KitchenStation } from './kitchen-routing.js';
import type { Order } from './order.js';

export type PrintJobStatus = 'PENDING' | 'PRINTING' | 'PRINTED' | 'FAILED';

export interface PrintJob {
  id: string;
  orderId: string;
  orderNumber: string;
  station: KitchenStation | 'CUSTOMER';
  copies: number;
  payload: string;
  status: PrintJobStatus;
  attempts: number;
  lastError: string | null;
  createdAt: string;
}

export function buildPrintPayload(order: Order, station: KitchenStation | 'CUSTOMER'): string {
  const items = order.items.map((item) => `${item.quantity} x ${item.nameAr}${item.note ? ` — ${item.note}` : ''}`).join('\n');
  if (station === 'CUSTOMER') return `#${order.orderNumber}\n${items}\n----------------\nالإجمالي: ${order.total.toFixed(2)} ج.م\n`;
  return `#${order.orderNumber} | ${station}\n${items}\n`;
}

export function createPrintJob(input: { id: string; order: Order; station: KitchenStation | 'CUSTOMER'; copies?: number; now?: Date }): PrintJob {
  return { id: input.id, orderId: input.order.id, orderNumber: input.order.orderNumber, station: input.station, copies: input.copies ?? 1, payload: buildPrintPayload(input.order, input.station), status: 'PENDING', attempts: 0, lastError: null, createdAt: (input.now ?? new Date()).toISOString() };
}
