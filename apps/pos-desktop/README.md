# Restaurant POS Desktop

Desktop POS foundation for branch operation.

## Architecture

- UI: React + TypeScript (planned)
- Desktop shell: Tauri 2 (planned)
- Local database: SQLite (planned)
- Sync worker: offline-first queue (planned)
- Printer worker: local print queue (planned)
- Central API: `services/api`

## Non-negotiable offline behavior

The branch POS must remain usable for core operations when the central API is unavailable. Local writes are authoritative for the device while offline and are queued with an idempotency key for synchronization when connectivity returns.

## Security boundary

The desktop client never owns central financial closing authority. Local users operate only within permissions granted to their role; central/supervisor operations remain server-authorized and audited.
