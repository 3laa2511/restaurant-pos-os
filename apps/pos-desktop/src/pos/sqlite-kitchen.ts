import type { LocalDatabaseBridge } from './tauri-bridge.js';
import type { KitchenTicket, KitchenTicketStatus } from './kitchen-api.js';
import type { PosRuntimeIdentity } from './runtime-identity.js';

export interface OfflineKitchenTransition {
  ticketId: string;
  target: KitchenTicketStatus;
  expectedVersion: number;
  reason: string | null;
}

type LocalKitchenTicket = {
  id: string;
  order_id: string;
  branch_id: string;
  station: string;
  status: KitchenTicketStatus;
  version: number;
  order_number: string;
  order_type: string;
  items_json: string;
  created_at: string;
  sent_at: string | null;
  preparing_at: string | null;
  ready_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  updated_at: string;
};

function toTicket(row: LocalKitchenTicket): KitchenTicket {
  return {
    id: row.id,
    orderId: row.order_id,
    branchId: row.branch_id,
    station: row.station as KitchenTicket['station'],
    status: row.status,
    version: Number(row.version),
    items: JSON.parse(row.items_json) as KitchenTicket['items'],
    createdAt: row.created_at,
    sentAt: row.sent_at,
    preparingAt: row.preparing_at,
    readyAt: row.ready_at,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    cancellationReason: row.cancellation_reason,
  };
}

export async function ensureKitchenLocalSchema(db: LocalDatabaseBridge): Promise<void> {
  await db.execute(`CREATE TABLE IF NOT EXISTS kitchen_tickets (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    branch_id TEXT NOT NULL,
    station TEXT NOT NULL,
    status TEXT NOT NULL,
    version INTEGER NOT NULL,
    order_number TEXT NOT NULL,
    order_type TEXT NOT NULL,
    items_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    sent_at TEXT,
    preparing_at TEXT,
    ready_at TEXT,
    completed_at TEXT,
    cancelled_at TEXT,
    cancellation_reason TEXT,
    updated_at TEXT NOT NULL
  )`);
  await db.execute('CREATE INDEX IF NOT EXISTS idx_kitchen_tickets_station_status ON kitchen_tickets(station, status, updated_at)');
}

export async function cacheKitchenTickets(db: LocalDatabaseBridge, tickets: readonly KitchenTicket[]): Promise<void> {
  if (!tickets.length) return;
  const statements = tickets.map((ticket) => ({
    sql: `INSERT INTO kitchen_tickets (
      id, order_id, branch_id, station, status, version, order_number, order_type,
      items_json, created_at, sent_at, preparing_at, ready_at, completed_at,
      cancelled_at, cancellation_reason, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      order_id = excluded.order_id,
      branch_id = excluded.branch_id,
      station = excluded.station,
      status = excluded.status,
      version = excluded.version,
      order_number = excluded.order_number,
      order_type = excluded.order_type,
      items_json = excluded.items_json,
      created_at = excluded.created_at,
      sent_at = excluded.sent_at,
      preparing_at = excluded.preparing_at,
      ready_at = excluded.ready_at,
      completed_at = excluded.completed_at,
      cancelled_at = excluded.cancelled_at,
      cancellation_reason = excluded.cancellation_reason,
      updated_at = excluded.updated_at`,
    params: [
      ticket.id, ticket.orderId, ticket.branchId, ticket.station, ticket.status, ticket.version,
      ticket.order?.orderNumber ?? ticket.orderId,
      ticket.order?.type ?? 'UNKNOWN',
      JSON.stringify(ticket.items), ticket.createdAt, ticket.sentAt ?? null, ticket.preparingAt ?? null,
      ticket.readyAt ?? null, ticket.completedAt ?? null, ticket.cancelledAt ?? null,
      ticket.cancellationReason ?? null, new Date().toISOString(),
    ],
  }));
  await db.transaction(statements);
}

export async function getCachedKitchenTickets(db: LocalDatabaseBridge, station?: string | null): Promise<KitchenTicket[]> {
  const rows = await db.query<LocalKitchenTicket>(
    `SELECT * FROM kitchen_tickets ${station ? 'WHERE station = ?' : ''} ORDER BY updated_at ASC`,
    station ? [station] : [],
  );
  return rows.map(toTicket);
}

export async function enqueueKitchenTransition(
  db: LocalDatabaseBridge,
  identity: PosRuntimeIdentity,
  command: OfflineKitchenTransition,
  clientSequence: number,
): Promise<void> {
  if (!Number.isInteger(command.expectedVersion) || command.expectedVersion < 1) throw new Error('Kitchen ticket version is invalid');
  if (command.target === 'CANCELLED' && !command.reason?.trim()) throw new Error('Cancellation reason is required');
  const idempotencyKey = `${identity.deviceId}:kitchen:${command.ticketId}:${command.expectedVersion}:${command.target}`;
  const payload = JSON.stringify({
    target: command.target,
    expectedVersion: command.expectedVersion,
    reason: command.reason?.trim() || null,
  });
  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO sync_queue (
      id, device_id, branch_id, entity_type, entity_id, operation,
      idempotency_key, client_sequence, payload, occurred_at, status, attempts, last_error, created_at, updated_at
    ) VALUES (?, ?, ?, 'KITCHEN_TICKET', ?, 'UPDATE', ?, ?, ?, ?, 'PENDING', 0, NULL, ?, ?)`,
    [
      `${identity.deviceId}:kitchen-sync:${crypto.randomUUID()}`,
      identity.deviceId,
      identity.branchId,
      command.ticketId,
      idempotencyKey,
      clientSequence,
      payload,
      now,
      now,
      now,
    ],
  );
}

export async function applyOptimisticKitchenCache(
  db: LocalDatabaseBridge,
  command: OfflineKitchenTransition,
): Promise<void> {
  const timestamp = new Date().toISOString();
  const timestampColumn = command.target === 'PREPARING'
    ? 'preparing_at'
    : command.target === 'READY'
      ? 'ready_at'
      : command.target === 'COMPLETED'
        ? 'completed_at'
        : command.target === 'CANCELLED'
          ? 'cancelled_at'
          : 'sent_at';
  const reasonSql = command.target === 'CANCELLED' ? ', cancellation_reason = ?' : '';
  await db.execute(
    `UPDATE kitchen_tickets SET status = ?, version = ?, ${timestampColumn} = ?, updated_at = ?${reasonSql}
     WHERE id = ? AND version = ?`,
    [
      command.target,
      command.expectedVersion + 1,
      timestamp,
      timestamp,
      ...(command.target === 'CANCELLED' ? [command.reason?.trim() || null] : []),
      command.ticketId,
      command.expectedVersion,
    ],
  );
}
