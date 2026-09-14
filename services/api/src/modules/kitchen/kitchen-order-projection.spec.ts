import { describe, expect, it } from '@jest/globals';
import { OrderStatus } from '../orders/order-status.js';
import { deriveOrderStatusFromKitchenTickets, shouldAdvanceOrderStatus } from './kitchen-order-projection.js';

describe('deriveOrderStatusFromKitchenTickets', () => {
  it('keeps the order in kitchen when tickets are only sent', () => {
    expect(deriveOrderStatusFromKitchenTickets(['SENT_TO_KITCHEN', 'SENT_TO_KITCHEN'])).toBe('SENT_TO_KITCHEN');
  });

  it('projects preparing when any active ticket is preparing', () => {
    expect(deriveOrderStatusFromKitchenTickets(['READY', 'PREPARING'])).toBe('PREPARING');
  });

  it('projects ready when every non-terminal ticket is ready', () => {
    expect(deriveOrderStatusFromKitchenTickets(['READY', 'COMPLETED', 'CANCELLED'])).toBe('READY');
  });

  it('projects closed when all tickets are completed or cancelled and at least one completed', () => {
    expect(deriveOrderStatusFromKitchenTickets(['COMPLETED', 'CANCELLED'])).toBe('CLOSED');
  });

  it('projects cancelled when every ticket is cancelled', () => {
    expect(deriveOrderStatusFromKitchenTickets(['CANCELLED', 'CANCELLED'])).toBe('CANCELLED');
  });

  it('rejects an empty ticket set', () => {
    expect(() => deriveOrderStatusFromKitchenTickets([])).toThrow('without kitchen tickets');
  });
});

describe('shouldAdvanceOrderStatus', () => {
  it('advances through the kitchen lifecycle only', () => {
    expect(shouldAdvanceOrderStatus(OrderStatus.SENT_TO_KITCHEN, OrderStatus.PREPARING)).toBe(true);
    expect(shouldAdvanceOrderStatus(OrderStatus.PREPARING, OrderStatus.READY)).toBe(true);
    expect(shouldAdvanceOrderStatus(OrderStatus.READY, OrderStatus.CLOSED)).toBe(true);
  });

  it('does not move an order backwards when tickets race or arrive out of order', () => {
    expect(shouldAdvanceOrderStatus(OrderStatus.READY, OrderStatus.PREPARING)).toBe(false);
    expect(shouldAdvanceOrderStatus(OrderStatus.CLOSED, OrderStatus.READY)).toBe(false);
  });

  it('allows kitchen cancellation but does not reopen a cancelled or closed order', () => {
    expect(shouldAdvanceOrderStatus(OrderStatus.PREPARING, OrderStatus.CANCELLED)).toBe(true);
    expect(shouldAdvanceOrderStatus(OrderStatus.CANCELLED, OrderStatus.CANCELLED)).toBe(false);
    expect(shouldAdvanceOrderStatus(OrderStatus.CLOSED, OrderStatus.CANCELLED)).toBe(false);
  });
});
