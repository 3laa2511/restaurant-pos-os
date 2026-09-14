import { routeOrderItems } from './kitchen-routing.js';

describe('routeOrderItems', () => {
  it('groups items into a deterministic station order', () => {
    const result = routeOrderItems([
      { id: 'b1', productId: 'p1', quantity: 1, station: 'PACKING', nameSnapshot: 'Bag' },
      { id: 'k1', productId: 'p2', quantity: 2, station: 'KITCHEN', nameSnapshot: 'Burger', note: ' No onions ' },
      { id: 'd1', productId: 'p3', quantity: 1, station: 'BEVERAGE', nameSnapshot: 'Cola' },
      { id: 'k2', productId: 'p4', quantity: 1, station: 'KITCHEN', nameSnapshot: 'Fries' },
    ]);

    expect(result).toEqual([
      {
        station: 'KITCHEN',
        items: [
          { orderItemId: 'k1', quantity: 2, name: 'Burger', note: 'No onions' },
          { orderItemId: 'k2', quantity: 1, name: 'Fries', note: null },
        ],
      },
      { station: 'BEVERAGE', items: [{ orderItemId: 'd1', quantity: 1, name: 'Cola', note: null }] },
      { station: 'PACKING', items: [{ orderItemId: 'b1', quantity: 1, name: 'Bag', note: null }] },
    ]);
  });

  it('rejects duplicate order items', () => {
    expect(() => routeOrderItems([
      { id: 'same', productId: 'p1', quantity: 1, station: 'KITCHEN', nameSnapshot: 'Burger' },
      { id: 'same', productId: 'p2', quantity: 1, station: 'PACKING', nameSnapshot: 'Bag' },
    ])).toThrow('Duplicate order item same');
  });

  it('rejects invalid quantities and blank item ids', () => {
    expect(() => routeOrderItems([
      { id: 'k1', productId: 'p1', quantity: 0, station: 'KITCHEN', nameSnapshot: 'Burger' },
    ])).toThrow('Invalid quantity');

    expect(() => routeOrderItems([
      { id: '   ', productId: 'p1', quantity: 1, station: 'KITCHEN', nameSnapshot: 'Burger' },
    ])).toThrow('Order item id is required');
  });
});
