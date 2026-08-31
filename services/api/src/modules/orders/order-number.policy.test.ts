import { describe, expect, it } from '@jest/globals';
import { formatOrderNumber } from './order-number.policy.js';

describe('formatOrderNumber', () => {
  it('formats a branch sequence deterministically', () => {
    expect(formatOrderNumber('BR01', 1)).toBe('BR01-000001');
    expect(formatOrderNumber('BR01', 42)).toBe('BR01-000042');
  });

  it('rejects invalid sequences', () => {
    expect(() => formatOrderNumber('BR01', 0)).toThrow();
    expect(() => formatOrderNumber('BR01', 1.5)).toThrow();
  });
});
