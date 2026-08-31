import type { CartState, OrderType } from './types.js';

export type OrderStatus = 'DRAFT' | 'CONFIRMED' | 'SENT_TO_KITCHEN' | 'PAID' | 'CANCELLED';

export interface OrderItemSnapshot {
  productId: string;
  nameAr: string;
  nameEn: string;
  sku: string;
  unitPrice: number;
  quantity: number;
  note: string | null;
}

export interface Order {
  id: string;
  orderNumber: string;
  branchId: string;
  deviceId: string;
  cashierId: string;
  type: OrderType;
  status: OrderStatus;
  items: OrderItemSnapshot[];
  subtotal: number;
  discount: number;
  deliveryFee: number;
  total: number;
  createdAt: string;
}

export function createOrder(input: { id: string; orderNumber: string; branchId: string; deviceId: string; cashierId: string; cart: CartState; now?: Date }): Order {
  if (!input.id || !input.orderNumber || !input.branchId || !input.deviceId || !input.cashierId) throw new Error('Order identity is required');
  if (!input.cart.items.length) throw new Error('Cannot create an empty order');
  const subtotal = input.cart.items.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
  const total = Math.max(0, subtotal - input.cart.discount + input.cart.deliveryFee);
  return {
    id: input.id,
    orderNumber: input.orderNumber,
    branchId: input.branchId,
    deviceId: input.deviceId,
    cashierId: input.cashierId,
    type: input.cart.orderType,
    status: 'DRAFT',
    items: input.cart.items.map((item) => ({ productId: item.product.id, nameAr: item.product.nameAr, nameEn: item.product.nameEn, sku: item.product.sku, unitPrice: item.product.price, quantity: item.quantity, note: item.note || null })),
    subtotal,
    discount: input.cart.discount,
    deliveryFee: input.cart.deliveryFee,
    total,
    createdAt: (input.now ?? new Date()).toISOString(),
  };
}

export function confirmOrder(order: Order): Order {
  if (order.status !== 'DRAFT') throw new Error(`Cannot confirm order from ${order.status}`);
  return { ...order, status: 'CONFIRMED' };
}
