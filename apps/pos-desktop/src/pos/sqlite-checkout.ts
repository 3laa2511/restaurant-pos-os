import type { Order } from './order.js';
import type { PrintJob } from './print-job.js';
import type { LocalDatabaseBridge } from './tauri-bridge.js';

export interface CheckoutPersistenceInput {
  db: LocalDatabaseBridge;
  order: Order;
  printJobs: readonly PrintJob[];
  idempotencyKey: string;
  clientSequence: number;
  now?: string;
}

export function buildCheckoutStatements(input: Omit<CheckoutPersistenceInput, 'db'>) {
  const now = input.now ?? input.order.createdAt;

  const statements: Array<{ sql: string; params: unknown[] }> = [
    {
      sql: `INSERT INTO orders (
        id, order_number, branch_id, device_id, cashier_id, type, status,
        subtotal, discount, delivery_fee, total, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        input.order.id,
        input.order.orderNumber,
        input.order.branchId,
        input.order.deviceId,
        input.order.cashierId,
        input.order.type,
        input.order.status,
        input.order.subtotal,
        input.order.discount,
        input.order.deliveryFee,
        input.order.total,
        input.order.createdAt,
        now,
      ],
    },
    ...input.order.items.map((item, index) => ({
      sql: `INSERT INTO order_items (
        id, order_id, product_id, name_ar, name_en, sku, unit_price, quantity, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        `${input.order.id}:item:${index}`,
        input.order.id,
        item.productId,
        item.nameAr,
        item.nameEn,
        item.sku,
        item.unitPrice,
        item.quantity,
        item.note,
      ],
    })),
    ...input.printJobs.map((job) => ({
      sql: `INSERT INTO print_jobs (
        id, order_id, station, payload, status, attempts, last_error, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        job.id,
        job.orderId,
        job.station,
        job.payload,
        job.status,
        job.attempts,
        job.lastError,
        job.createdAt,
      ],
    })),
    {
      sql: `INSERT INTO sync_queue (
        id, entity_type, entity_id, operation, idempotency_key,
        client_sequence, payload, status, attempts, last_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        `${input.order.id}:sync`,
        'ORDER',
        input.order.id,
        'CREATE',
        input.idempotencyKey,
        input.clientSequence,
        JSON.stringify(input.order),
        'PENDING',
        0,
        null,
        now,
        now,
      ],
    },
  ];

  return statements;
}

export async function persistCheckout(input: CheckoutPersistenceInput): Promise<void> {
  if (!input.idempotencyKey) throw new Error('Checkout idempotency key is required');
  if (!Number.isInteger(input.clientSequence) || input.clientSequence < 0) {
    throw new Error('Checkout client sequence must be a non-negative integer');
  }

  await input.db.transaction(buildCheckoutStatements(input));
}
