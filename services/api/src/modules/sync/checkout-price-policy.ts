type CheckoutPriceItem = { productId: string; unitPrice: number };
type CatalogProduct = {
  id: string;
  price: unknown;
  branchProducts: readonly {
    enabled: boolean;
    available: boolean;
    priceOverride: unknown;
  }[];
};

function catalogAmount(value: unknown, label: string): number {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`Invalid server catalog price for ${label}`);
  }
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

/**
 * Offline clients can submit orders after local catalog data has been modified.
 * The API must not trust client-supplied unit prices when accepting a sale.
 * Branch-specific price overrides take precedence over the tenant product price.
 */
export function assertCheckoutPrices(
  items: readonly CheckoutPriceItem[],
  products: readonly CatalogProduct[],
): void {
  const byId = new Map(products.map((product) => [product.id, product]));

  for (const item of items) {
    const product = byId.get(item.productId);
    if (!product) throw new Error('Checkout contains unavailable products');

    const branchProduct = product.branchProducts[0];
    if (branchProduct && (!branchProduct.enabled || !branchProduct.available)) {
      throw new Error('Checkout contains a product unavailable at this branch');
    }

    const expectedPrice = branchProduct?.priceOverride == null
      ? catalogAmount(product.price, item.productId)
      : catalogAmount(branchProduct.priceOverride, item.productId);

    if (item.unitPrice !== expectedPrice) {
      throw new Error('Checkout item price does not match the current server catalog');
    }
  }
}
