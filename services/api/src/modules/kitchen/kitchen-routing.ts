export type KitchenStation = 'KITCHEN' | 'BEVERAGE' | 'PACKING';

const STATION_ORDER: readonly KitchenStation[] = ['KITCHEN', 'BEVERAGE', 'PACKING'];

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

/**
 * Builds deterministic station tickets from an order snapshot.
 * Routing is pure: persistence, ticket lifecycle and authorization remain server-side.
 */
export function routeOrderItems(items: readonly RoutableOrderItem[]): KitchenTicketDraft[] {
  const grouped = new Map<KitchenStation, KitchenTicketItem[]>();
  const seenOrderItemIds = new Set<string>();

  for (const item of items) {
    const orderItemId = item.id.trim();
    if (!orderItemId) throw new Error('Order item id is required');
    if (seenOrderItemIds.has(orderItemId)) {
      throw new Error(`Duplicate order item ${orderItemId}`);
    }
    seenOrderItemIds.add(orderItemId);

    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new Error(`Invalid quantity for order item ${orderItemId}`);
    }
    if (!STATION_ORDER.includes(item.station)) {
      throw new Error(`Invalid kitchen station for order item ${orderItemId}`);
    }

    const list = grouped.get(item.station) ?? [];
    list.push({
      orderItemId,
      quantity: item.quantity,
      name: item.nameSnapshot.trim(),
      note: item.note?.trim() || null,
    });
    grouped.set(item.station, list);
  }

  return STATION_ORDER.flatMap((station) => {
    const routedItems = grouped.get(station);
    return routedItems?.length ? [{ station, items: routedItems }] : [];
  });
}
