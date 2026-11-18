# ADR: Branch-scoped dining areas and table lifecycle

- **Status:** Accepted for the current API-backed implementation
- **Date:** 2026-11-18
- **Scope:** Restaurant POS OS only

## Context

The supplied UI Directions reference includes a dining-room board, table configuration, table states, order association, and a manager-authorized clear-table flow. The existing data model had orders and kitchen tickets but no dining-area or dining-table entity. A static table board would create misleading state and could not safely coordinate with orders.

## Decision

1. Dining areas and tables are owned by both a tenant and a branch. Composite foreign keys prevent an area/table from being attached to another branch or tenant.
2. `DiningTable` has a constrained lifecycle: `AVAILABLE`, `OCCUPIED`, `RESERVED`, `CLEANING`, and `OUT_OF_SERVICE`.
3. An occupied table references one current order. A unique composite key prevents one order from occupying multiple tables at the same time; the order relation also enforces same-branch ownership.
4. Table writes use an integer `version` and conditional updates to reject stale concurrent actions.
5. Only eligible `DINE_IN` orders in open lifecycle states may be seated. Seating writes an order event and an audit event in the same transaction.
6. Clearing is a manager-permission action with a required reason. It is rejected until the linked order is terminal (`CLOSED`, `CANCELLED`, `VOIDED`, or `REFUNDED`). A successful clear releases the order link and moves the table to `CLEANING`; a separate manager action returns it to `AVAILABLE`.
7. `DINING_TABLE_VIEW` is granted to cashier and manager roles; `DINING_TABLE_MANAGE` is manager-only. Workspace allowlists also restrict the actions to POS/Management.
8. Both tables have forced PostgreSQL RLS policies using tenant and branch visibility. API operations run inside the existing transaction-local RLS context.

## Explicit non-goals / remaining work

- This implementation does **not** claim multi-cashier LAN coordination during a total branch internet outage.
- Table mutations currently require the API; there is no offline table queue or conflict-reconciliation protocol.
- Clear-table does not yet cancel or reconcile kitchen tickets. It requires a terminal order and records the manager action.
- A cashier-initiated manager credential override / approval token is not implemented; the current action is available only to a user with manager permission.
- The POS checkout path still persists locally first. A table is assigned only after its order is visible to the server through the existing order/sync path.
- The current desktop board is functional but not yet pixel-perfect against the 32-page UI reference.

## Migration and safety

- Added as `0033_dining_tables`, after the existing `0032_product_modifiers` migration.
- No historical migration was renamed or rewritten.
- No production migration or deployment was performed.
- Rollback, if required before production use, should be a separately reviewed migration that first verifies no dining records or order associations exist; do not edit an already-applied migration.
