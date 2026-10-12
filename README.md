# Restaurant POS OS

Professional multi-branch restaurant POS and central operations platform.

## Current scope

Desktop-first restaurant operations:

- Branch POS
- Central Call Center
- Kitchen operations
- Delivery dispatch
- Payments and cashier shifts
- Inventory foundation
- Offline-first operation and synchronization
- Thermal printing
- RBAC and audit trail
- Arabic / English with RTL / LTR

## Future-ready channels

The core is designed to support customer web, mobile, QR ordering and delivery aggregators later without redesigning the Order Core.

## Architecture principles

- Offline-first at branch level
- Explicit order state transitions
- Server-side authorization
- Idempotent commands
- Auditable sensitive actions
- Local print queue
- Compact, station-aware printing
- Arabic and English as first-class UI languages

## Deployment decision — target architecture

For the initial rollout of 2–10 branches with two cashiers per branch, the target architecture is:

1. **Windows POS clients:** Tauri + React, with a persistent local SQLite database for the workstation's supported offline operations.
2. **Branch LAN service (required for shared offline operation):** a branch-local service/database that coordinates both cashiers when the branch loses internet. This is a target component, not yet confirmed as implemented.
3. **Central API:** NestJS remains the authority for business rules, authentication, authorization, central reporting, and synchronization acceptance.
4. **Central database:** PostgreSQL, initially evaluated as a managed service to reduce operational burden. Supabase is a candidate provider, not a committed deployment.
5. **Development/test:** Docker Compose for repeatable local PostgreSQL and integration-test environments.

### Offline guarantees and limits

- A local SQLite database on each workstation alone does **not** coordinate stock, orders, or invoice sequences between two cashiers during a full internet outage.
- Shared offline selling requires the branch-local service and LAN to remain available. If that service also fails, the system must show a clear degraded mode and follow a tested recovery policy; do not promise seamless multi-cashier operation.
- Sync must be idempotent, resumable, auditable, and safe against duplicate orders/payments. Conflicts affecting stock or money need explicit reconciliation rules.
- The local branch service, central service, and database need authentication, device identity, backups, monitoring, and a documented recovery procedure.

## Delivery plan

1. Audit existing authentication, authorization, RLS, Tauri IPC trust boundaries, and branch/device isolation.
2. Verify local SQLite persistence, sync queue leases, idempotency keys, retry/recovery behavior, and server-side duplicate protection.
3. Design and implement the branch-local LAN service and shared offline transaction model for two concurrent cashiers.
4. Verify inventory concurrency, invoice numbering, payments, shift reconciliation, and accounting postings under online/offline and retry scenarios.
5. Prepare production hosting, secrets, TLS, database pooling, backups, restore drills, observability, and Windows packaging.
6. Pilot one branch with two cashiers; expand only after documented acceptance tests pass.

## Documentation

- Architecture and product decisions are recorded here until the detailed master blueprint is restored or added.
