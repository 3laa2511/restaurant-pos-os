import type { OrderStatus } from './order-status.js';
import type { AuthContext } from '../auth/authorization.types.js';

export interface CreateOrderRecord {
  id: string;
  orderNumber: string;
  branchId: string;
  tenantId: string;
  createdById: string;
  source: string;
  type: string;
  status: OrderStatus;
  total: string;
  version: number;
}

export interface OrderRepository {
  findById(id: string, tenantId: string, context: AuthContext): Promise<CreateOrderRecord | null>;
  create(input: Omit<CreateOrderRecord, 'version'>, context: AuthContext): Promise<CreateOrderRecord>;
  transition(
    id: string,
    tenantId: string,
    expectedVersion: number,
    status: OrderStatus,
    context: AuthContext,
  ): Promise<CreateOrderRecord>;
}
