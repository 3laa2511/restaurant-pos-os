# Restaurant POS OS — Completion and Release Plan

> Living checklist for the active `feat/recovery-integration` workstream. The original PR branches remain preserved; this branch is the integration target and does not imply production readiness. Update this file as tasks are verified. A merged implementation is not considered complete until its automated checks and required database/product verification pass.

## Recovery integration — 2026-11-06

- [x] Create a protected integration branch and umbrella PR #13 targeting `main`; no direct main update.
- [x] Carry forward the tenant/catalog foundation and HR, payroll, accounting, inventory, workspace and offline-first code from the existing feature stack.
- [x] Integrate the RPOS branding correction, frozen pnpm lockfile, shared payment-policy package and workspace capability matrix.
- [x] Integrate kitchen conflict persistence through the repository layer.
- [x] Add branchless account role-scope validation and regression tests while retaining tenant-scoped branch selection for tenant-wide owners.
- [x] Add sync authentication-expiry pause/release behavior without consuming retry budget or changing queue order/idempotency.
- [x] Carry forward Payment Hub intent policy, provider account/attempt/inbox schema and provider-neutral webhook adapter contract; no live provider verifier or settlement side effects.
- [x] Add Prisma migration provider lock and isolate rejected RLS SQL assertions in separate transactions.
- [x] Add local API build/start/migrate scripts, Vite CORS defaults and a non-default-password first-run local owner bootstrap.
- [x] Add Windows local development instructions and Replica-derived engineering/quality workflow.
- [x] API Quality Gate passed on `ec7718bf2f6a809a7ec5a4aa5dde8ac0e7cb922b`; desktop validation steps passed through Tauri native check on that SHA. A newer documentation-only commit requires fresh CI before release.
- [x] Add a shared authenticated branch-scope resolver and apply it to HR, Accounting report endpoints and Inventory stock queries.
- [x] Make HR employee creation/listing and attendance listing inherit the authenticated branch; add branch-scoped payroll periods, a safe partial-unique migration and a payroll-period list endpoint.
- [x] Default accounting journal posting to the authenticated branch and validate all referenced branches against the tenant.
- [x] Require tenant-wide access to approve, dispatch from, or receive into the central warehouse; preserve branch-level stock operations.
- [x] API and POS Desktop Quality Gates passed on exact SHA `f87d01dfed9c0655ccccfed4eb59ef46dd972963`, including PostgreSQL migrations, local owner login/session smoke test and Tauri native check.
- [x] API and POS Desktop Quality Gates passed on exact integration SHA `8f58f72f0e77aec55b366e570ad012b70fffa830` (API, desktop lint/typecheck/tests/build, and Tauri native check).
- [x] Connect Inventory recipe editor and Accounting general-ledger, cash/bank and read-only reconciliation report views; correct inclusive end-date and cash/bank opening-balance handling.
- [x] Improve HR branch selection/attendance employee lookup and add payroll statement detail view.
- [x] Add call-center and dispatch order search/status filters with customer contact, delivery address, timestamps and item counts; order mutation/assignment lifecycle remains a separate API phase.
- [x] Add tenant-scoped supplier directory and supplier selection on inventory receipts; purchase-order lifecycle remains open.
- [x] API and POS Desktop Quality Gates passed on exact integration SHA `136aa42f078eb8cfc4edf4aa24cf4f1db7a58030` (PostgreSQL migrations/bootstrap, API build and tests, desktop lint/typecheck/sync tests/frontend build and Tauri native check).
- [x] API and POS Desktop Quality Gates passed on exact integration SHA `ab05f25b121cffab0858b0f4c5b919bfa5bfca73` (API tests, desktop lint/typecheck/sync tests/frontend build and Tauri native check).
- [ ] Execute the Windows local bootstrap against a clean Docker PostgreSQL instance and verify sign-in in the actual Vite/Tauri runtime.
- [ ] Restore the FlutterFlow source and 32-page UI Directions PDF, then verify visual/interaction parity.
- [ ] Complete menu variants/modifiers as a tenant-safe end-to-end feature; the old backup branch is not safe to cherry-pick.
- [ ] Complete the branch-LAN coordination service for multi-cashier offline operation.
- [ ] Finish typed Tauri IPC migration, workspace workflows, installer/updater, diagnostics and release operations.

## Product contract (must not regress)

- One application with permission-gated workspaces: POS, Call Center, HR, Accounting, Inventory, Management, Kitchen, Dispatch, plus Settings.
- Workspace choice is validated by the backend and persisted in the database session; never trust a frontend-only workspace selection.
- Tenant and branch scope comes from authenticated context/session, not request-body tenant identifiers.
- Secure-by-default authorization: explicit permissions, server-side DTO validation, rate limiting, RLS/FORCE RLS where applicable, transaction-local RLS context, audit trails, and pooled-connection safety.
- Core business chain: Order → Payment → Inventory consumption → COGS → Accounting → Reports/Reconciliation.
- Preserve historical invoices/orders and audit history. Starting a new business cycle changes operational dashboard scope; it must not delete history or reset cumulative accounting.
- Support branch operation and idempotent/offline sync without duplicate orders, payments, inventory movements, or journals.
- Arabic/English and RTL/LTR; financial and operational figures must use consistent backend data sources.
- Clean Architecture/SOLID/DRY; avoid one-off monoliths and silent corrective writes.

## Verified foundations (do not reopen without a regression)

- [x] Tenant/branch/user/device auth context and permission-based access foundations.
- [x] Transaction-local PostgreSQL RLS context and migration `0019_rls_transaction_context`.
- [x] Business-cycle lifecycle, history preservation, open-shift safeguards, and cycle-scoped operational dashboard queries.
- [x] Accounting core, chart-of-accounts management, fiscal periods, immutable posted journals, reversal workflow, and core financial reports.
- [x] System account seeding and controlled account resolution (missing/inactive/non-posting/wrong-type accounts reject posting).
- [x] Payment settlement posts sales accounting and invokes recipe-based inventory consumption in the same serializable transaction.
- [x] API Quality Gate #467 and POS Desktop Quality Gate #1245 passed for commit `86827ce10191ee6dafb0a710cf4210a53ac6cce8`.

## Active phase — COGS correctness and CI

- [x] Fix zero-cost recipe retry edge case: consumption idempotency is checked against order consumption movements as well as the COGS journal. A zero-cost recipe can consume stock without creating a zero-value journal, so the journal alone is not a sufficient guard.
- [ ] Confirm both API and POS Desktop Quality Gates pass for the COGS idempotency fix.
- [ ] Add/verify automated cases: no recipe; exact recipe consumption; waste percentage; insufficient stock rolls back payment, journal, order transition, and movements; retry/duplicate settlement does not double-consume; shared ingredient across order lines; tenant/branch isolation.
- [ ] Validate the COGS migration and seeded accounts against a real PostgreSQL database with RLS enabled.

## Accounting and reconciliation

- [ ] Reconciliation report implementation is on the branch: `GET /api/accounting/reports/reconciliation` (read-only, `ACCOUNTING_VIEW`, tenant/branch scoped); compare paid-order original totals to `ORDER_SALE` revenue journals, recipe consumption movement costs to `ORDER_COGS`, and current branch stock valuation to the inventory control account. CI and behavioral/integration tests still need to pass before marking this complete.

- [ ] Reconcile sales/order totals against revenue journals.
- [ ] Reconcile payment allocations and cash-drawer movements against payment journals.
- [ ] Reconcile order recipe consumption movements against COGS journals.
- [ ] Reconcile stock valuation against the inventory control account.
- [ ] Report mismatches with source IDs and actionable detail; never silently mutate balances to make reports agree.
- [ ] Verify General Ledger opening balance, Trial Balance, P&L date/fiscal-period boundaries, Balance Sheet equity/net-income presentation, and Cash/Bank opening and closing balances.
- [ ] Validate refund/void policy. Do not reverse COGS unless an explicit physical stock-return workflow restores the ingredients.

## Inventory / procurement / warehouse

- [ ] Verify purchase receipts, average-cost calculation, stock adjustments, waste, and accounting entries.
- [ ] Verify central warehouse ↔ branch transfers: request, approval, dispatch, receipt, in-transit valuation, and permissions.
- [ ] Ensure movement idempotency and concurrency safety for receipts, adjustments, transfers, and consumption.
- [ ] Validate insufficient-stock behavior, decimal precision, units/conversion factors, negative-stock policy, and low-stock alerts.
- [ ] Confirm branch inventory and warehouse access cannot cross tenant or unauthorized branch boundaries.

## HR and payroll

- [ ] Validate employee profiles, work schedules, attendance/check-in/out, late/overtime calculations, approvals, and branch scoping.
- [ ] Validate payroll period lifecycle, draft/approval/payment/cancellation transitions, allocation totals, payroll accrual, and payroll payment journals.
- [ ] Confirm salary/employee sensitive data is permission-restricted, audited, and not exposed to unrelated workspaces.
- [ ] Add real-DB RLS, isolation, concurrency, and idempotency tests for HR/payroll operations.

## Security, reliability, and database operations

- [ ] Review every controller route for permission guards, DTO validation, tenant/branch scope, safe errors, and rate limits on sensitive/auth endpoints.
- [ ] Audit RLS + FORCE RLS coverage, policies, runtime DB role grants, and tests using the actual application role.
- [ ] Verify transaction-local RLS context is set on the same transaction connection for every protected write path.
- [ ] Verify connection-pool limits/timeouts, transaction isolation, serialization retries, graceful shutdown, and no connection-per-request patterns.
- [ ] Verify migration ordering, clean-database bootstrap, existing-database upgrade, seed repeatability, backup/restore, and rollback/recovery notes.
- [ ] Review secrets/config validation, logging of sensitive fields, audit coverage, dependency/security scans, and production error handling.
- [ ] Verify offline sync conflict handling, sequence/idempotency guarantees, and recovery after network loss.

## Product and UI QA backlog

- [ ] Fix and verify device-invoice collection confirmation that can remain loading indefinitely.
- [ ] Fix Operations fulfillment section load errors.
- [ ] Align dashboard, sales report, and business-cycle data sources; confirm old-cycle figures are not mixed into current-cycle operational totals.
- [ ] Translate remaining financial labels and states consistently in Arabic; verify English and RTL/LTR layouts.
- [ ] Fix mobile/laptop scrolling, sticky-header overlays, and slow/white-screen navigation.
- [ ] Regression-test responsive Staff, Repair Lab, Dashboard, POS, Kitchen, and workspace navigation.
- [ ] Test cashier shift and lounge-session blockers against the authoritative database state, not stale dashboard counters.
- [ ] Test loading/empty/error states, permission-denied states, and recovery/retry behavior on key workflows.

## Release gates — all required before calling the project complete

- [ ] API Quality Gate green on final commit.
- [ ] POS Desktop Quality Gate green on final commit.
- [ ] Required real-PostgreSQL/RLS integration tests pass; skipped tests are explicitly identified, not counted as passing.
- [ ] Migrations apply to both a clean database and an existing database snapshot; Prisma schema/client are in sync.
- [ ] End-to-end smoke: sign in → choose authorized workspace → open shift → create/route order → kitchen lifecycle → settle payment → stock/COGS → accounting reports → refund/void policy → audit trail.
- [ ] Cross-tenant and cross-branch negative tests pass.
- [ ] UI/mobile regression and release configuration reviewed.
- [ ] Final report records verified completed items, remaining blockers, commit SHA, CI run links, and database verification evidence.

## Operating rule

Do not mark a task done because code was written or a workflow was started. Mark it done only after the relevant check reports success. If a real database or UI cannot be exercised in the current environment, keep it explicitly open for verification.
