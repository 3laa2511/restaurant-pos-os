import { assertCheckoutPrices } from './checkout-price-policy.js';

describe('assertCheckoutPrices', () => {
  it('accepts the tenant catalog price when no branch override exists', () => {
    expect(() => assertCheckoutPrices(
      [{ productId: 'product-1', unitPrice: 12.5 }],
      [{ id: 'product-1', price: '12.50', branchProducts: [] }],
    )).not.toThrow();
  });

  it('uses the branch-specific price override when configured', () => {
    expect(() => assertCheckoutPrices(
      [{ productId: 'product-1', unitPrice: 9 }],
      [{
        id: 'product-1',
        price: '12.50',
        branchProducts: [{ enabled: true, available: true, priceOverride: '9.00' }],
      }],
    )).not.toThrow();
  });

  it('rejects a client-tampered unit price', () => {
    expect(() => assertCheckoutPrices(
      [{ productId: 'product-1', unitPrice: 0.01 }],
      [{ id: 'product-1', price: '12.50', branchProducts: [] }],
    )).toThrow('Checkout item price does not match the current server catalog');
  });

  it('rejects products disabled or unavailable at the branch', () => {
    expect(() => assertCheckoutPrices(
      [{ productId: 'product-1', unitPrice: 12.5 }],
      [{
        id: 'product-1',
        price: '12.50',
        branchProducts: [{ enabled: true, available: false, priceOverride: null }],
      }],
    )).toThrow('Checkout contains a product unavailable at this branch');
  });
});
