import type { CartState, OrderType } from './types.js';
import { calculatePricing } from './pricing.js';

export type OrderStatus = 'DRAFT' | 'CONFIRMED' | 'SENT_TO_KITCHEN' | 'PAID' | 'CANCELLED';

export interface OrderItemModifierSnapshot {
  groupId: string;
  optionId: string;
  nameAr: string;
  nameEn: string;
  priceDelta: number;
}

export interface OrderItemSnapshot {
  productId: string;
  nameAr: string;
  nameEn: string;
  sku: string;
  unitPrice: number;
  quantity: number;
  note: string | null;
  modifiers: OrderItemModifierSnapshot[];
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
  tax: number;
  serviceFee: number;
  deliveryFee: number;
  total: number;
  createdAt: string;
}

export function createOrder(input: { id: string; orderNumber: string; branchId: string; deviceId: string; cashierId: string; cart: CartState; now?: Date }): Order {
  if (!input.id || !input.orderNumber || !input.branchId || !input.deviceId || !input.cashierId) throw new Error('Order identity is required');
  if (!input.cart.items.length) throw new Error('Cannot create an empty order');

  const items = input.cart.items.map((item) => {
    const modifiers = (item.modifiers ?? []).map((modifier) => {
      if (!modifier.groupId || !modifier.optionId) throw new Error('Modifier selection identity is required');
      return modifier;
    });
    return { item, modifiers };
  });

  const pricing = calculatePricing({
    items: items.map(({ item }) => ({ unitPrice: item.product.price, quantity: item.quantity })),
    discount: input.cart.discount > 0 ? { kind: 'FIXED', value: input.cart.discount } : null,
    deliveryFee: input.cart.deliveryFee,
  });

  return {
    id: input.id,
    orderNumber: input.orderNumber,
    branchId: input.branchId,
    deviceId: input.deviceId,
    cashierId: input.cashierId,
    type: input.cart.orderType,
    status: 'DRAFT',
    items: items.map(({ item, modifiers }) => ({
      productId: item.product.id,
      nameAr: item.product.nameAr,
      nameEn: item.product.nameEn,
      sku: item.product.sku,
      unitPrice: item.product.price,
      quantity: item.quantity,
      note: item.note || null,
      modifiers: modifiers.map(({ groupId, optionId }) => ({ groupId, optionId, nameAr: optionId, nameEn: optionId, priceDelta: 0 })),
    })),
    subtotal: pricing.subtotal,
    discount: pricing.discount,
    tax: pricing.tax,
    serviceFee: pricing.serviceFee,
    deliveryFee: pricing.deliveryFee,
    total: pricing.total,
    createdAt: (input.now ?? new Date()).toISOString(),
  };
}

export function confirmOrder(order: Order): Order {
  if (order.status !== 'DRAFT') throw new Error(`Cannot confirm order from ${order.status}`);
  return { ...order, status: 'CONFIRMED' };
}
