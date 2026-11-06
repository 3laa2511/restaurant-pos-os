# Workspace Capability Matrix — Restaurant POS OS

**Reviewed:** 2026-10-28  
**UI branch reviewed:** `feat/hr-accounting-inventory`  
**Review branch:** `fix/review-phase-0`  
**Purpose:** distinguish visible UI behavior from endpoints already present in the API. Endpoint existence does not prove production readiness or full business-rule correctness.

## Current UI vs API

| Workspace | Current UI behavior observed | API capabilities observed in controllers | Gap / next implementation |
|---|---|---|---|
| POS | Operational checkout, local persistence, shift/cash drawer and sync flows exist in `RealPosApp` and `apps/pos-desktop/src/pos/*`. | Orders, payments, shifts, sync, kitchen and related modules exist. | Test end-to-end checkout and recovery paths, especially duplicate submission, cash reconciliation, auth expiry and conflict handling. |
| Kitchen | Routed to `KitchenDisplay`. | Kitchen ticket, routing and sync endpoints/services exist. | Verify station-specific permissions, state transitions, printing, and offline conflict UX end to end. |
| HR | `HrWorkspace` now provides employee creation/listing, attendance history with check-in/check-out actions, and payroll period creation/approval/payment controls. Permission checks remain enforced by the API. | Employee creation; attendance listing/check-in/check-out; payroll period creation, approval, payment and detail endpoints exist. | Verify payroll detail visibility, employee edit/deactivation lifecycle (not currently exposed by API), overtime calculations, separation of duties, and full PostgreSQL-backed workflows. |
| Accounting | `AccountingWorkspace` now connects account creation, fiscal periods/close, balanced manual journal posting, journal listing/reversal, trial balance, P&L and balance-sheet summaries. | Accounts CRUD/deactivation; fiscal periods; manual journal posting/reversal; journal listing; trial balance; general ledger, P&L, balance sheet, reconciliation and cash-bank reports exist. | Add account edit/deactivation, general-ledger and reconciliation/cash-bank detail screens; verify totals, date boundaries and audit behavior against real PostgreSQL. |
| Inventory | `InventoryWorkspace` now connects ingredient catalog/creation, stock balances, warehouses, purchase receipts with idempotency keys, adjustments and transfer lifecycle actions. | Ingredient listing/creation; stock listing; receipts; adjustments; warehouses; transfers create/approve/dispatch/receive; recipe management exist. | Recipe read/write is now connected through a permission-gated, tenant-scoped endpoint and an editor in InventoryWorkspace. Remaining: supplier/purchase-order lifecycle; verify unit conversion, weighted average cost, concurrency, transfer valuation and branch isolation. |
| Call Center | `OperationalWorkspace` fetches `GET /api/operations/call-center/orders` and renders a read-only order table. | The inspected operations controller exposes order listing only; order mutation endpoints live elsewhere and were not traced in this pass. | Trace existing order/customer APIs, then add order creation/editing and assignment only after permissions and allowed state transitions are mapped. |
| Dispatch | `OperationalWorkspace` fetches `GET /api/operations/dispatch/orders` and renders a read-only order table. | The inspected operations controller exposes order listing only; dispatch mutations were not found in that controller. | Determine whether dispatch/assignment endpoints exist in another module. If absent, design them with explicit state transitions, branch scope, audit events and idempotency before UI work. |
| Management | `OperationalWorkspace` fetches `GET /api/operations/management/overview`; shows branch/customer counts and order status totals. | The inspected operations controller exposes this overview only. | Build a role-scoped management dashboard and reports from verified endpoints. Do not present overview metrics as a full admin/HR/accounting control plane. |
| Settings | Supports starting a new business cycle after a confirmation prompt. | Business-cycle current/start-new endpoints exist. | Add guarded settings for company/branch/device and configuration only when backed by audited, permission-protected APIs. |

## Additional gaps confirmed during recovery

- The separate `backup/menu-variants-2026-09-16` branch is not integrated. Its old migration conflicts with the occupied `0008` tenant-catalog migration and does not enforce tenant ownership for modifier groups/options. Its API only reads variants/modifiers; order creation and immutable order-line price snapshots are not wired. A new tenant-safe schema, API validation, local SQLite contract, POS selection UI and pricing/idempotency tests are required.
- A first-run local owner bootstrap and API/Vite startup path now exist on the recovery branch. They still require a real Windows Docker Desktop run and sign-in smoke test on the user's machine.
- Payment Hub intent and webhook adapter contracts are integrated, but there is no configured real provider, provider-specific signature verifier, automatic settlement, or accounting booking consumer.
- The existing print worker renews its lease during long printer operations; this does not replace real printer-device QA, paper/connection failure recovery, or audited reprint acceptance tests.

## High-priority security review

### Generic local SQL command surface

The inspected Tauri layer exposes `db_execute`, `db_query`, and `db_transaction` commands accepting caller-supplied SQL. Parameters are bound, but statement/table scope is not allowlisted. The frontend bridge exposes these generic methods to renderer code.

**Recommendation:** inventory all call sites first, then replace generic SQL commands with typed, domain-specific Tauri commands/repository operations. Preserve transactions, parameter binding, local migrations, and offline behavior. Do not remove commands blindly; checkout, kitchen, sync, shift and print queues currently depend on this layer.

### Branding

The login screen previously displayed `BO'SH SYSTEM`. On the review branch, the visible mark and heading have been changed to `RPOS` and `Restaurant POS OS`. Latest CI validation is pending for that change.

## Implementation sequence

1. **Stabilize trust boundaries:** typed Tauri command design, command allowlist/capability review, session-expiry recovery, branch/tenant authorization and audit coverage.
2. **POS and Kitchen E2E:** checkout idempotency, payment references, cash drawer reconciliation, offline sync conflicts, kitchen state transitions and print retry behavior.
3. **Inventory:** ingredients, receipts, adjustments, transfers, recipes and stock movement audit.
4. **HR/Payroll:** employee management, attendance, payroll calculation, approval and payment with separation of duties.
5. **Accounting:** accounts, fiscal periods, journals/reversals and reports; preserve immutable posted entries and reconciliation controls.
6. **Call Center/Dispatch:** trace or design order mutation/assignment APIs, then build forms, state transitions and assignment controls.
7. **Management/Admin:** company/branch/device/user administration, role-scoped reports, audit trail and operational alerts.
8. **Installer, diagnostics and updater:** prerequisite checks, safe remediation with explicit consent for privileged actions, signed/verified updates, rollback and auditable recovery.

## Validation rules for each workspace

- Use server-provided permissions and server-side branch/tenant scope; client-side hiding is not authorization.
- Verify request DTOs and endpoint permission decorators before adding each mutation.
- Include loading, empty, error, retry and expired-session states.
- Add API integration tests plus UI-level smoke tests for the core path.
- Keep financial amounts in integer minor units or validated decimal types according to the domain model; never use unvalidated floating-point arithmetic for ledger truth.
- No production migration, live deployment, or merge as part of this review pass.
