import type { Order } from './order.js';
import type { PrintJob } from './print-job.js';
import type { LocalDatabaseBridge } from './tauri-bridge.js';
import type { PaymentInput } from '../../../../services/api/src/modules/payments/payment-policy.js';
import { assertIdempotencyKey } from '../../../../services/api/src/modules/orders/idempotency.js';

type SqlStatement = { sql: string; params: unknown[] };
type ExistingSyncRecord = { entity_id: string; payload: string };

export interface CheckoutPersistenceInput {
  db: LocalDatabaseBridge;
  order: Order;
  printJobs: readonly PrintJob[];
  idempotencyKey: string;
  clientSequence: number;
  now?: string;
}

export interface CompletedCheckoutPersistenceInput extends CheckoutPersistenceInput {
  payment: PaymentInput;
  paymentId: string;
}

function buildOrderStatements(input: Omit<CheckoutPersistenceInput, 'db'>): SqlStatement[] {
  const now = input.now ?? input.order.createdAt;
  return [
    {
      sql: `INSERT INTO orders (
        id, order_number, branch_id, device_id, cashier_id, type, status,
        subtotal, discount, delivery_fee, total, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        input.order.id, input.order.orderNumber, input.order.branchId, input.order.deviceId,
        input.order.cashierId, input.order.type, input.order.status, input.order.subtotal,
        input.order.discount, input.order.deliveryFee, input.order.total, input.order.createdAt, now,
      ],
    },
    ...input.order.items.map((item, index) => ({
      sql: `INSERT INTO order_items (
        id, order_id, product_id, name_ar, name_en, sku, unit_price, quantity, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        `${input.order.id}:item:${index}`, input.order.id, item.productId, item.nameAr,
        item.nameEn, item.sku, item.unitPrice, item.quantity, item.note,
      ],
    })),
  ];
}

function buildPrintStatements(input: Omit<CheckoutPersistenceInput, 'db'>): SqlStatement[] {
  return input.printJobs.map((job) => ({
    sql: `INSERT INTO print_jobs (
      id, order_id, station, payload, status, attempts, last_error, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [job.id, job.orderId, job.station, job.payload, job.status, job.attempts, job.lastError, job.createdAt],
  }));
}

function buildSyncStatement(input: Omit<CheckoutPersistenceInput, 'db'>): SqlStatement {
  const now = input.now ?? input.order.createdAt;
  return {
    sql: `INSERT INTO sync_queue (
      id, entity_type, entity_id, operation, idempotency_key, client_sequence,
      payload, status, attempts, last_error, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      `${input.order.id}:sync`, 'ORDER', input.order.id, 'CREATE', input.idempotencyKey,
      input.clientSequence, JSON.stringify(input.order), 'PENDING', 0, null, now, now,
    ],
  };
}

export function buildCheckoutStatements(input: Omit<CheckoutPersistenceInput, 'db'>): SqlStatement[] {
  return [...buildOrderStatements(input), ...buildPrintStatements(input), buildSyncStatement(input)];
}

export function buildCompletedCheckoutStatements(
  input: Omit<CompletedCheckoutPersistenceInput, 'db'>,
): SqlStatement[] {
  const now = input.now ?? input.order.createdAt;
  return [
    ...buildOrderStatements(input),
    {
      sql: `INSERT INTO payments (
        id, order_id, shift_id, method, amount, reference, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params: [
        input.paymentId, input.payment.orderId, input.payment.shiftId, input.payment.method,
        input.payment.amount, input.payment.reference ?? null, now,
      ],
    },
    ...buildPrintStatements(input),
    buildSyncStatement(input),
  ];
}

function validatePersistenceInput(input: CheckoutPersistenceInput): void {
  assertIdempotencyKey(input.idempotencyKey);
  if (!Number.isInteger(input.clientSequence) || input.clientSequence < 0) {
    throw new Error('Checkout client sequence must be a non-negative integer');
  }
}

async function assertNotAlreadyCommitted(input: CheckoutPersistenceInput): Promise<boolean> {
  const rows = await input.db.query<ExistingSyncRecord>(
    `SELECT entity_id, payload FROM sync_queue WHERE idempotency_key = ? LIMIT 1`,
    [input.idempotencyKey],
  );
  if (!rows.length) return false;
  const expectedPayload = JSON.stringify(input.order);
  if (rows[0].entity_id !== input.order.id || rows[0].payload !== expectedPayload) {
    throw new Error('Checkout idempotency key was reused with a different order');
  }
  return true;
}

export async function persistCheckout(input: CheckoutPersistenceInput): Promise<void> {
  validatePersistenceInput(input);
  if (await assertNotAlreadyCommitted(input)) return;
  await input.db.transaction(buildCheckoutStatements(input));
}

export async function persistCompletedCheckout(input: CompletedCheckoutPersistenceInput): Promise<void> {
  validatePersistenceInput(input);
  if (input.payment.orderId !== input.order.id) throw new Error('Payment order does not match checkout order');
  if (input.payment.amount !== input.order.total) throw new Error('Payment amount does not match checkout total');
  if (await assertNotAlreadyCommitted(input)) return;
  await input.db.transaction(buildCompletedCheckoutStatements(input));
}
