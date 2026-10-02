import { describe, expect, it } from '@jest/globals';
import { validate } from 'class-validator';
import { LoginDto } from './auth.dto.js';

async function errorsFor(input: Partial<LoginDto>) {
  const dto = Object.assign(new LoginDto(), input);
  return validate(dto);
}

describe('LoginDto server-side validation', () => {
  it('accepts a valid login payload', async () => {
    const errors = await errorsFor({ username: 'cashier01', password: 'correct-password', workspace: 'POS' });
    expect(errors).toHaveLength(0);
  });

  it('rejects malformed usernames', async () => {
    const errors = await errorsFor({ username: 'cashier 01', password: 'correct-password' });
    expect(errors.some((error) => error.property === 'username')).toBe(true);
  });

  it('rejects short passwords', async () => {
    const errors = await errorsFor({ username: 'cashier01', password: 'short' });
    expect(errors.some((error) => error.property === 'password')).toBe(true);
  });

  it('rejects unknown workspace values', async () => {
    const errors = await errorsFor({ username: 'cashier01', password: 'correct-password', workspace: 'NOT_A_WORKSPACE' as never });
    expect(errors.some((error) => error.property === 'workspace')).toBe(true);
  });
});
