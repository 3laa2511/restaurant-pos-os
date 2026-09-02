import type { LocalDatabaseBridge } from './tauri-bridge.js';

interface SequenceRow {
  next_sequence: number;
}

export async function nextDeviceSequence(
  db: LocalDatabaseBridge,
  deviceId: string,
): Promise<number> {
  const normalizedDeviceId = deviceId.trim();
  if (!normalizedDeviceId) throw new Error('Device id is required for sequence allocation');

  await db.execute(
    `INSERT INTO device_sequences (id, device_id, next_sequence, updated_at)
     VALUES (?, ?, 0, datetime('now'))
     ON CONFLICT(device_id) DO NOTHING`,
    [normalizedDeviceId, normalizedDeviceId],
  );

  const rows = await db.query<SequenceRow>(
    `UPDATE device_sequences
     SET next_sequence = next_sequence + 1,
         updated_at = datetime('now')
     WHERE device_id = ?
     RETURNING next_sequence`,
    [normalizedDeviceId],
  );

  const sequence = rows[0]?.next_sequence;
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error('Failed to allocate device sequence');
  }
  return sequence;
}
