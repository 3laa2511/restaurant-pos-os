# ADR: Offline-first branch topology

- Status: Proposed; implementation and acceptance tests are still required.
- Scope: 2 cashiers per branch, 2–10 branches initially.
- Decision: keep the existing Tauri + React desktop client and NestJS API; use PostgreSQL as the central system of record. For reliable shared operation during WAN outages, introduce a branch-local coordination service only after validating the existing local SQLite and sync flows.
- Do not treat two independent SQLite files as a shared branch database. During an internet outage, separate devices cannot safely coordinate shared stock, order state, or cashier operations without a reachable local coordinator or an explicit conflict policy.

## Target topology

1. Both POS devices connect over the branch LAN to a local branch coordinator.
2. The coordinator serializes shared branch operations and persists a durable local outbox.
3. Each device retains only the local cache/state required for UI resilience; it must not independently decide globally shared stock availability.
4. The coordinator syncs accepted operations to the central NestJS API when WAN connectivity returns.
5. The central API validates tenant, branch, device, user permissions, business rules, and idempotency before committing centrally.
6. Sync acknowledgements are durable and replay-safe. A lost response must not create a second order or payment.

## Decisions still open

- Whether the branch coordinator should be a small NestJS service with local PostgreSQL or a single-writer SQLite service. Select based on deployment/backup/restore testing, not preference alone.
- How the two tills discover and authenticate to the coordinator on the LAN.
- What happens if the coordinator itself fails. A second coordinator requires leader/lease/fencing design; it must not be added as an uncoordinated active-active pair.
- Which workflows may be performed offline (cash, card terminal reference-only, refunds, discounts, customer credit, inventory adjustments). Each workflow needs a policy.
- Whether the kitchen and dispatch workstations must continue during a WAN outage.

## Required safety controls

- Unique operation IDs and idempotency keys across device retries.
- Server-side authorization on every central write; never trust client-supplied tenant or branch scope.
- Explicit schema migrations and compatibility checks for offline clients.
- Transactional local persistence of order, payment intent/record, print job, and outbox item where applicable.
- Ordered or dependency-aware sync; visible pending/rejected/conflict states.
- Append-only audit trail for financial actions and no silent deletion of failed operations.
- Tested backup and restore for both the branch coordinator and central database.
- Device identities and TLS/authentication for coordinator traffic; the LAN is not automatically trusted.

## Acceptance tests before pilot

1. Two cashiers sell concurrently while WAN is disconnected; no duplicate IDs and no lost orders.
2. Both attempt to sell the last unit of the same stock item; the defined stock policy is enforced.
3. The WAN drops after the central API commits but before the client receives the response; retry creates no duplicate order/payment.
4. The coordinator restarts with pending outbox entries; all accepted entries resume safely.
5. A device is revoked or belongs to another branch; central sync rejects unauthorized writes and records the rejection.
6. A failed sync is visible and recoverable; it is never silently marked synced.
7. Restore from backup and reconcile order, payment, cash drawer, inventory, and journal totals.

## Security review note

The current Tauri Rust command surface includes generic `db_execute`, `db_query`, and `db_transaction` commands that accept SQL text from the frontend bridge. Treat this as a renderer-to-native trust-boundary risk until the complete call graph and Tauri capabilities are reviewed. Parameter binding helps protect values but does not constrain which tables or operations the caller may request. The preferred hardening is domain-specific native commands/repositories with validated inputs, followed by tests proving arbitrary SQL cannot be invoked from renderer-facing APIs.

The Windows print path also builds a PowerShell command string from a temporary path. Although the filename is filtered and quotes are escaped, replace shell-based printing with a native/spooler API or pass arguments without interpolating them into PowerShell source, then test on Windows.

## Delivery rule

This ADR documents the intended design only. It does not assert that the coordinator, security hardening, deployment, or acceptance tests have been implemented.
