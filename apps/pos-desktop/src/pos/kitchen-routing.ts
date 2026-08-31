import type { Order } from './order.js';

export type KitchenStation = 'KITCHEN' | 'BEVERAGE' | 'PACKING';

export interface RoutedKitchenItem {
  station: KitchenStation;
  orderId: string;
  orderNumber: string;
  productId: string;
  nameAr: string;
  quantity: number;
  note: string | null;
}

export function routeOrderToKitchen(order: Order, stationByProduct: Readonly<Record<string, KitchenStation>>): RoutedKitchenItem[] {
  if (order.status !== 'CONFIRMED') throw new Error(`Only confirmed orders can be routed: ${order.status}`);
  return order.items.map((item) => ({
    station: stationByProduct[item.productId] ?? 'KITCHEN',
    orderId: order.id,
    orderNumber: order.orderNumber,
    productId: item.productId,
    nameAr: item.nameAr,
    quantity: item.quantity,
    note: item.note,
  }));
}
