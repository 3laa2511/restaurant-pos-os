# Tauri Generic SQL Surface — Call-Site Inventory

Date: 2026-10-29  
Repository: `3laa2511/restaurant-pos-os`  
Review branch: `fix/review-phase-0`  
Scope: source review only; no database or runtime behavior changed.

## Executive finding

The desktop renderer obtains a `LocalDatabaseBridge` from `createDatabaseBridge({ invoke })`. The bridge forwards arbitrary SQL strings and parameter arrays to Tauri commands `db_execute`, `db_query`, and `db_transaction`. Rust binds values through rusqlite parameters, which helps prevent value interpolation attacks, but the command boundary does not restrict which SQL statements or tables the renderer can request. This is a broad capability boundary, not proof of an exploitable vulnerability by itself.

Relevant implementation:
- `apps/pos-desktop/src/pos/tauri-bridge.ts` — generic renderer bridge.
- `apps/pos-desktop/src-tauri/src/lib.rs` — Tauri command definitions and registration; generic commands are registered in `generate_handler!`.

## Call sites confirmed in the first-pass source review

| File | Operations observed | Why it matters |
|---|---|---|
| `src/pos/sqlite-checkout.ts` | `query`, `transaction` | Atomically persists orders, items, payments, cash drawer movement, print jobs, and sync outbox records; preserve checkout atomicity and idempotency. |
| `src/pos/print-repository.ts` | `execute`, `query` | Claims print jobs with leases and records completion/failure. |
| `src/pos/sync-repository.ts` | `execute`, `query` | Claims sync queue items and updates status/lease/error state. |
| `src/pos/sqlite-cash-drawer.ts` | `query`, `execute` | Persists and reconciles cash movements. |
| `src/pos/sqlite-kitchen.ts` | `execute`, `query`, `transaction` | Creates/updates local kitchen ticket schema, caches tickets, and queues offline transitions. |
| `src/pos/sqlite-shift.ts` | `query`, `transaction` | Opens/closes local shifts and stores shift-related data. |
| `src/pos/sqlite-menu.ts` | `query`, `transaction` | Reads cached catalog and persists menu data. |
| `src/pos/sqlite-sequence.ts` | `execute`, `query` | Maintains local sequence allocation. |
| `src/KitchenDisplay.tsx` | `execute` | UI currently issues a direct DB operation; should move behind a typed repository. |
| `src/RealPosApp.tsx` | bridge construction | Exposes the generic bridge to application services. |

This is a first-pass list of confirmed usages, not a claim that every call site in every package has been exhaustively audited. Before removing or changing the commands, search the entire repository (including tests, worker modules, and less obvious imports) and capture every statement and behavior.

## Safe migration plan

1. **Freeze current behavior with tests.** Add/confirm tests for checkout atomicity/idempotency, offline queue ordering and 401 recovery, print lease ownership, cash-drawer idempotency/reconciliation, shift open/close, kitchen transition queueing, menu refresh, and sequence uniqueness.
2. **Build a complete usage inventory.** Search the entire repository for `createDatabaseBridge`, `LocalDatabaseBridge`, `db.execute`, `db.query`, `db.transaction`, and literal Tauri command names. Classify each SQL statement by domain and caller.
3. **Introduce typed domain commands/repositories** in small slices, starting with one low-risk domain. Keep SQL definitions inside trusted Rust commands or a narrow repository layer; renderer passes validated domain inputs, not SQL text.
4. **Keep transactions atomic.** Checkout must commit order, order items, payment, cash movement, print jobs, and sync outbox together. Do not split these into independent calls without an explicit transaction command.
5. **Avoid fragile SQL keyword allowlists.** SQL text parsing/allowlisting is not a reliable substitute for typed commands and can break valid operations.
6. **Add negative tests.** Verify renderer callers cannot request arbitrary table reads/writes or DDL through the public command interface; verify normal workflows remain supported.
7. **Remove generic commands only after migration and tests pass** and all callers are converted. Keep changes on a dedicated branch/PR; do not touch production data or merge automatically.

## Risk and sequencing

Priority: high for security-boundary hardening, but implementation must be staged because the current generic bridge underpins core offline workflows. Do not blindly delete the commands or replace them with a simplistic table allowlist. The next implementation task should be the full call-site scan and a test matrix, then a single typed-command slice with CI evidence.

## Validation status

The Phase 0 review documentation and workspace capability matrix are on PR #4. At the time of this inventory, both API Quality Gate and POS Desktop Quality Gate completed successfully on head commit `201c183cca56b48b43b90b02c525b3df53561b18`. This document itself is a source-review artifact; it does not change application behavior.
