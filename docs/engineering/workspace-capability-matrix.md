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
| HR | `ReadWorkspace` fetches `GET /api/hr/employees` and renders a read-only table. | Employee creation; attendance listing/check-in/check-out; payroll period creation, approval, payment and detail endpoints exist. | Build employee create/edit flow, attendance actions, payroll list/detail/approval/payment UI; show permissions and state transitions explicitly. |
| Accounting | `ReadWorkspace` fetches `GET /api/accounting/trial-balance` and renders a read-only table. | Accounts CRUD/deactivation; fiscal periods; manual journal posting/reversal; journal listing; trial balance; general ledger, P&L, balance sheet, reconciliation and cash-bank reports exist. | Build chart-of-accounts, fiscal-period, journal posting/reversal, and reports screens. Confirm approval/immutability and audit rules before exposing mutation controls. |
| Inventory | `ReadWorkspace` fetches `GET /api/inventory/stock` and renders a read-only table. | Ingredient listing/creation; stock listing; receipts; adjustments; warehouses; transfers create/approve/dispatch/receive; recipe management exist. | Build ingredient, receipt, adjustment, transfer lifecycle and recipe screens. Include unit conversion, quantity validation, source/destination branch checks and idempotency tests. |
| Call Center | `OperationalWorkspace` fetches `GET /api/operations/call-center/orders` and renders a read-only order table. | The inspected operations controller exposes order listing only; order mutation endpoints live elsewhere and were not traced in this pass. | Trace existing order/customer APIs, then add order creation/editing and assignment only after permissions and allowed state transitions are mapped. |
| Dispatch | `OperationalWorkspace` fetches `GET /api/operations/dispatch/orders` and renders a read-only order table. | The inspected operations controller exposes order listing only; dispatch mutations were not found in that controller. | Determine whether dispatch/assignment endpoints exist in another module. If absent, design them with explicit state transitions, branch scope, audit events and idempotency before UI work. |
| Management | `OperationalWorkspace` fetches `GET /api/operations/management/overview`; shows branch/customer counts and order status totals. | The inspected operations controller exposes this overview only. | Build a role-scoped management dashboard and reports from verified endpoints. Do not present overview metrics as a full admin/HR/accounting control plane. |
| Settings | Supports starting a new business cycle after a confirmation prompt. | Business-cycle current/start-new endpoints exist. | Add guarded settings for company/branch/device and configuration only when backed by audited, permission-protected APIs. |

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
