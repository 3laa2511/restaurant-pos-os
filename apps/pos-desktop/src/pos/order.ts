import type { CartState, ModifierGroup, OrderType } from './types.js';
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

function resolveModifiers(itemModifiers: NonNullable<CartState['items'][number]['modifiers']>, catalog: ModifierGroup[]): OrderItemModifierSnapshot[] {
  const groups = new Map(catalog.filter((group) => group.active).map((group) => [group.id, group]));
  const selectionsByGroup = new Map<string, Set<string>>();

  for (const selection of itemModifiers) {
    const group = groups.get(selection.groupId);
    if (!group) throw new Error(`Modifier group ${selection.groupId} is unavailable`);
    if (!Number.isInteger(group.minSelections) || !Number.isInteger(group.maxSelections) || group.minSelections < 0 || group.maxSelections < group.minSelections) {
      throw new Error(`Modifier group ${group.id} has invalid selection limits`);
    }
    const option = group.options.find((candidate) => candidate.id === selection.optionId && candidate.active);
    if (!option) throw new Error(`Modifier option ${selection.optionId} is unavailable`);
    if (!Number.isFinite(option.priceDelta) || option.priceDelta < 0) throw new Error(`Modifier option ${option.id} has invalid price`);
    const selections = selectionsByGroup.get(group.id) ?? new Set<string>();
    if (selections.has(option.id)) throw new Error(`Modifier option ${option.id} was selected more than once`);
    selections.add(option.id);
    selectionsByGroup.set(group.id, selections);
  }

  for (const group of groups.values()) {
    const count = selectionsByGroup.get(group.id)?.size ?? 0;
    if (count < group.minSelections || count > group.maxSelections) {
      throw new Error(`Modifier group ${group.id} requires ${group.minSelections}-${group.maxSelections} selections`);
    }
    if (group.required && count === 0) throw new Error(`Modifier group ${group.id} is required`);
  }

  return itemModifiers.map((selection) => {
    const group = groups.get(selection.groupId)!;
    const option = group.options.find((candidate) => candidate.id === selection.optionId && candidate.active)!;
    return { groupId: group.id, optionId: option.id, nameAr: option.nameAr, nameEn: option.nameEn, priceDelta: option.priceDelta };
  });
}

export function createOrder(input: { id: string; orderNumber: string; branchId: string; deviceId: string; cashierId: string; cart: CartState; modifierCatalog?: ModifierGroup[]; now?: Date }): Order {
  if (!input.id || !input.orderNumber || !input.branchId || !input.deviceId || !input.cashierId) throw new Error('Order identity is required');
  if (!input.cart.items.length) throw new Error('Cannot create an empty order');

  const catalog = input.modifierCatalog ?? [];
  const items = input.cart.items.map((item) => ({
    item,
    modifiers: resolveModifiers(item.modifiers ?? [], catalog),
  }));

  const pricing = calculatePricing({
    items: items.map(({ item, modifiers }) => ({ unitPrice: item.product.price, quantity: item.quantity, modifierPrices: modifiers.map((modifier) => modifier.priceDelta) })),
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
      modifiers,
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
