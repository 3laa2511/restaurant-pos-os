import { routeOrderItems, type KitchenStation } from '../kitchen/kitchen-routing.js';

export interface CheckoutKitchenLine {
  productId: string;
  quantity: number;
  note: string | null;
}

export interface CheckoutKitchenProduct {
  id: string;
  name: string;
  kitchenStation: KitchenStation;
}

/**
 * Build immutable KDS drafts from the validated checkout lines and the
 * server-loaded product catalogue. Client-supplied display names never choose
 * the kitchen station or replace the server's product name snapshot.
 */
export function buildCheckoutKitchenTickets(
  orderId: string,
  items: readonly CheckoutKitchenLine[],
  products: readonly CheckoutKitchenProduct[],
) {
  const productById = new Map(products.map((product) => [product.id, product]));
  return routeOrderItems(items.map((item, index) => {
    const product = productById.get(item.productId);
    if (!product) throw new Error(`Checkout product ${item.productId} is unavailable for kitchen routing`);
    return {
      id: `${orderId}:item:${index}`,
      productId: item.productId,
      quantity: item.quantity,
      station: product.kitchenStation,
      nameSnapshot: product.name,
      note: item.note,
    };
  }));
}
