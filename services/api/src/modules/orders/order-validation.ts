import { OrderType } from './order-types.js';
import { OrderSource } from './order-sources.js';

export interface CreateOrderCommand {
  branchId: string;
  createdById: string;
  source: OrderSource;
  type: OrderType;
  total: string;
  idempotencyKey: string;
}

export function validateCreateOrder(command: CreateOrderCommand): void {
  if (!command.branchId.trim()) throw new Error('Branch is required');
  if (!command.createdById.trim()) throw new Error('Creator is required');
  if (!command.idempotencyKey.trim()) throw new Error('Idempotency key is required');
  if (!/^\d+(\.\d{1,2})?$/.test(command.total) || Number(command.total) < 0) {
    throw new Error('Total must be a non-negative monetary value');
  }
}
