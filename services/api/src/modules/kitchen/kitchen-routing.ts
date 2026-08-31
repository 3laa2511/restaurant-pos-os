export type KitchenStation = 'KITCHEN' | 'BEVERAGE' | 'PACKING';

export interface RoutableOrderItem {
  id: string;
  productId: string;
  quantity: number;
  station: KitchenStation;
  nameSnapshot: string;
  note?: string | null;
}

export interface KitchenTicketItem {
  orderItemId: string;
  quantity: number;
  name: string;
  note: string | null;
}

export interface KitchenTicketDraft {
  station: KitchenStation;
  items: KitchenTicketItem[];
}

export function routeOrderItems(items: readonly RoutableOrderItem[]): KitchenTicketDraft[] {
  const grouped = new Map<KitchenStation, KitchenTicketItem[]>();

  for (const item of items) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new Error(`Invalid quantity for order item ${item.id}`);
    }
    const list = grouped.get(item.station) ?? [];
    list.push({
      orderItemId: item.id,
      quantity: item.quantity,
      name: item.nameSnapshot,
      note: item.note ?? null,
    });
    grouped.set(item.station, list);
  }

  return [...grouped.entries()].map(([station, routedItems]) => ({
    station,
    items: routedItems,
  }));
}
