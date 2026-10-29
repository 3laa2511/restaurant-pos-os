import type { LocalDatabaseBridge } from './tauri-bridge.js';

export interface RecentLocalOrder {
  order_number: string;
  type: string;
  total: number;
  status: string;
  created_at: string;
}

export async function listRecentLocalOrders(db: LocalDatabaseBridge): Promise<RecentLocalOrder[]> {
  const rows = await db.query<RecentLocalOrder>(
    'SELECT order_number, type, total, status, created_at FROM orders ORDER BY created_at DESC LIMIT 8',
  );
  return rows.map((row) => ({ ...row, total: Number(row.total) }));
}
