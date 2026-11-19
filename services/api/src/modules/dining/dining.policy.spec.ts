import { describe, expect, it } from '@jest/globals';
import { canTransitionDiningTableStatus, diningClearKitchenAction, isAssignableDiningOrderStatus, isTerminalDiningOrderStatus } from './dining.policy.js';

describe('dining table lifecycle policy', () => {
  it('allows only open dine-in order lifecycle states to be seated', () => {
    expect(isAssignableDiningOrderStatus('DRAFT')).toBe(true);
    expect(isAssignableDiningOrderStatus('READY')).toBe(true);
    expect(isAssignableDiningOrderStatus('CLOSED')).toBe(false);
    expect(isAssignableDiningOrderStatus('CANCELLED')).toBe(false);
  });

  it('requires a terminal order before a table can be cleared', () => {
    expect(isTerminalDiningOrderStatus('CLOSED')).toBe(true);
    expect(isTerminalDiningOrderStatus('CANCELLED')).toBe(true);
    expect(isTerminalDiningOrderStatus('PREPARING')).toBe(false);
  });

  it('cancels unfinished kitchen tickets, preserves completed work, and blocks unresolved READY tickets', () => {
    expect(diningClearKitchenAction('SENT_TO_KITCHEN')).toBe('CANCEL');
    expect(diningClearKitchenAction('PREPARING')).toBe('CANCEL');
    expect(diningClearKitchenAction('COMPLETED')).toBe('KEEP');
    expect(diningClearKitchenAction('CANCELLED')).toBe('KEEP');
    expect(diningClearKitchenAction('READY')).toBe('BLOCK');
  });

  it('keeps occupied and cleaning transitions behind dedicated actions', () => {
    expect(canTransitionDiningTableStatus('AVAILABLE', 'RESERVED')).toBe(true);
    expect(canTransitionDiningTableStatus('CLEANING', 'AVAILABLE')).toBe(true);
    expect(canTransitionDiningTableStatus('OUT_OF_SERVICE', 'AVAILABLE')).toBe(true);
    expect(canTransitionDiningTableStatus('OCCUPIED', 'AVAILABLE')).toBe(false);
    expect(canTransitionDiningTableStatus('OCCUPIED', 'CLEANING')).toBe(false);
  });
});
