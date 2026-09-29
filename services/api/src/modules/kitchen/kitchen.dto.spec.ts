import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { KitchenTicketStatusDto } from './kitchen.dto.js';

describe('kitchen request validation', () => {
  it('accepts a valid ticket transition', async () => {
    const errors = await validate(
      plainToInstance(KitchenTicketStatusDto, {
        target: 'READY',
        reason: 'Order completed',
        expectedVersion: 3,
      }),
    );

    expect(errors).toHaveLength(0);
  });

  it('rejects invalid target and non-positive expectedVersion', async () => {
    const errors = await validate(
      plainToInstance(KitchenTicketStatusDto, {
        target: 'DELETE',
        expectedVersion: 0,
      }),
    );

    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects an overlong reason', async () => {
    const errors = await validate(
      plainToInstance(KitchenTicketStatusDto, {
        target: 'PREPARING',
        reason: 'x'.repeat(501),
      }),
    );

    expect(errors.length).toBeGreaterThan(0);
  });
});
