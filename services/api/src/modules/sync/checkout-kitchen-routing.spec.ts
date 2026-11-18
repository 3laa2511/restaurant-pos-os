import { describe, expect, it } from '@jest/globals';
import { buildCheckoutKitchenTickets } from './checkout-kitchen-routing.js';

describe('buildCheckoutKitchenTickets', () => {
  it('routes checkout lines by server product station and preserves item snapshots', () => {
    const tickets = buildCheckoutKitchenTickets(
      'order-1',
      [
        { productId: 'food-1', quantity: 2, note: 'بدون بصل' },
        { productId: 'drink-1', quantity: 1, note: null },
        { productId: 'food-2', quantity: 1, note: 'زيادة تسوية' },
      ],
      [
        { id: 'food-1', name: 'Burger', kitchenStation: 'KITCHEN' },
        { id: 'drink-1', name: 'Cola', kitchenStation: 'BEVERAGE' },
        { id: 'food-2', name: 'Steak', kitchenStation: 'KITCHEN' },
      ],
    );

    expect(tickets.map((ticket) => ticket.station)).toEqual(['KITCHEN', 'BEVERAGE']);
    expect(tickets[0].items).toEqual([
      { orderItemId: 'order-1:item:0', quantity: 2, name: 'Burger', note: 'بدون بصل' },
      { orderItemId: 'order-1:item:2', quantity: 1, name: 'Steak', note: 'زيادة تسوية' },
    ]);
    expect(tickets[1].items[0]).toEqual({
      orderItemId: 'order-1:item:1',
      quantity: 1,
      name: 'Cola',
      note: null,
    });
  });

  it('rejects a checkout line whose product is absent from the server catalogue', () => {
    expect(() => buildCheckoutKitchenTickets(
      'order-2',
      [{ productId: 'missing', quantity: 1, note: null }],
      [],
    )).toThrow('Checkout product missing is unavailable for kitchen routing');
  });
});
