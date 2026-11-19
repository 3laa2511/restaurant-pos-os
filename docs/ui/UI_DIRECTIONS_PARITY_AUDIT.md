# UI Directions — Screen-to-Code Parity Audit

**Repository:** `3laa2511/restaurant-pos-os`  
**Branch reviewed:** `feat/recovery-integration`  
**Reviewed through:** kitchen print-routing/cache work on `feat/recovery-integration` (2026-11-19)  
**Reference:** user-supplied `Restaurant POS OS — UI Directions.html` (32 embedded pages)

## 1. Reference contract

The supplied file is the canonical visual and interaction reference for this workstream. Its application map explicitly classifies functional areas as:

- **14 — موجود في التطبيق** (present in the app)
- **6 — API جاهز · الواجهة لاحقاً** (API ready; UI later)
- **8 — تصميم فقط** (design only)

These are the map's own category counts (functional areas), not a count of the 32 embedded HTML page artifacts. The 32 artifacts include variants and modal/detail pages.

Reference-wide requirements observed in the embedded page templates:

- Arabic-first layout with `lang="ar"` and `dir="rtl"`.
- IBM Plex Sans Arabic, weights 400/500/600/700.
- Shared navigation and branch/device/session context.
- POS has distinct day and night themes.
- The day theme uses a cool light surface palette (background `#F2F5FA`, surface `#FFFFFF`, text `#0C1626`, muted `#566177`, primary `#1F4E9C`, success `#0E7C4A`, danger `#B3261E`).
- The night theme uses a dark palette (background `#0B0F17`, surface `#121823`, text `#E5EAF3`, muted `#8D9AB2`, primary `#6BA3FF`, success `#4ADE9A`, danger `#FF8A7A`).
- Operational states are explicit: offline/local mode, pending sync, review-required conflicts, manager approval, cash variance, kitchen ticket state, and device/branch identity.
- Sensitive actions are gated and auditable. The cashier must not override server-owned tax, service-fee, discount, or approval policy.

## 2. Screen-by-screen parity matrix

**Status vocabulary:**  
**Exists / partial** = a related working component or flow exists, but the reference screen/state is not yet fully matched.  
**API only / missing UI** = backend support or data path exists, but the dedicated reference UI is absent.  
**Design only / missing** = no matching dedicated screen was found in the inspected desktop route.  
**Reference-only modal** = a designed modal/flow with no confirmed equivalent UI in the inspected route.

| # | Reference page | Expected scope from reference | Current repository evidence | Audit result / required work |
|---:|---|---|---|---|
| 1 | خريطة التطبيق | App map and status overview | No dedicated app-map route; workspaces are selected in `LoginGate.tsx` | **Missing.** Build navigation/map and show capability state without claiming placeholder workspaces are complete. |
| 2 | نافذة — الخصم وموافقة المدير | Discount choices; one-time manager credential approval bound to the order amount | `RealPosApp.tsx` has checkout and payment state, but no confirmed matching discount/manager-approval dialog in inspected code | **Reference-only modal.** Implement only with server-validated discount policy and auditable manager approval. |
| 3 | إعدادات التسعير | Branch tax, service fee, caps, discounts; server calculates final amount | Backend payment/pricing policy foundation is present in the integrated work; no dedicated pricing-settings screen in desktop routes | **API only / missing UI.** Add policy editor after confirming exact API contracts and permissions. |
| 4 | نافذة — مسح الطاولة | Manager-authorized table clear with required reason and kitchen-ticket cancellation | `DiningWorkspace.tsx` supports cashier-initiated manager re-authentication or direct manager action; API verifies terminal order state, table version, cancels eligible unfinished kitchen tickets and audits all writes | **Exists / partial.** Cashier submits manager username/password; a separate branch-scoped manager session executes the action and is immediately revoked. `SENT_TO_KITCHEN`/`PREPARING` tickets are cancelled in the same transaction with order events/audit records; `READY` tickets block clearing until resolved in Kitchen. No persistent approval grant or offline approval path. |
| 5 | POS نهاري | Day-mode cashier: categories/products/cart/order type/checkout/status | `RealPosApp.tsx` and `real-pos.css`; local cart, checkout, shift, cash drawer and sync workers exist | **Exists / partial.** Core sale flow exists; visual parity, table service, discounts, server totals, modifiers, and exact states need completion. |
| 6 | POS ليلي | Same cashier workflow in night theme | Same `RealPosApp.tsx`; only one current dark visual treatment in `real-pos.css` | **Exists / partial.** Add a true theme switch and match reference night palette; do not confuse current dark CSS with reference parity. |
| 7 | المطبخ | Station filters, new/preparing/ready tickets, local mode, elapsed time | `KitchenDisplay.tsx` is reachable from the cashier sidebar; it retains SQLite cache, offline transition queue, station filtering, sync-state badges, conflict reconciliation and server-side version checks. Product `kitchenStation` now flows from the API menu into a dedicated SQLite routing cache; local print jobs split KITCHEN/BEVERAGE/PACKING orders and Tauri resolves dedicated printer environment variables | **Functional foundation / visual parity pending.** Existing offline-capable KDS is reused rather than duplicated. Verify ticket send-lock, elapsed-time presentation and end-to-end offline replay against the 32-screen reference; validate printer station configuration on real Windows devices. |
| 8 | مركز التحكم | All-branch control center, sales KPIs, branch connection and channel breakdown | `OperationalWorkspace` in `WorkspaceRouter.tsx` only loads `operations/management/overview` and displays basic counts/status totals | **Exists / partial, major gap.** Replace generic summary with the reference control-center hierarchy and branch/channel metrics supported by API. |
| 9 | نظرة مباشرة على الفرع | Branch-level live sales, shift, connectivity, devices and sync | No dedicated branch live-overview route found | **API only / missing UI** where data endpoints exist; verify endpoint coverage then build the screen. |
| 10 | تسجيل الدخول | Registered branch/device context, staff selection and PIN keypad, offline-aware sign-in | `LoginGate.tsx` currently uses username/password, workspace selector, and editable branch/device fields | **Exists / partial, interaction mismatch.** Preserve the current backend authentication contract until PIN auth is implemented; separate device identity from user-selectable login fields. |
| 11 | تسجيل جهاز | Device registration wizard, branch/type/printer and one-time registration code | No device-registration screen in desktop route | **Design only / missing.** Backend/device registration contract must be checked before UI. |
| 12 | فتح الوردية | Cashier/device/branch context, preflight checks and opening drawer balance | `RealPosApp.tsx` has `handleOpenShift` and local shift persistence | **Exists / partial.** Add reference preflight checklist and opening-cash denomination entry; preserve current local shift safeguards. |
| 13 | إغلاق الوردية | Pending-sync gate, denomination count, expected/actual variance and close confirmation | `RealPosApp.tsx` has drawer reconciliation, actual cash input and variance preview | **Exists / partial.** Current UI needs the reference denomination summary and explicit pending-sync block before close. |
| 14 | الصالة | Table map, zones, table state and open order | `DiningWorkspace.tsx` is opened from POS navigation; API-backed areas/tables, server dine-in order picker, seating, status transitions and manager clear flow exist | **Exists / partial.** Current layout is a functional API-backed table board, not yet a pixel-level match to the reference; no offline table mutations or LAN coordination. |
| 15 | التحصيل | Cash collection keypad, received amount/change, receipt and drawer action | `RealPosApp.tsx` checkout supports CASH/CARD payment state | **Exists / partial.** Implement dedicated collection UX; split/card are not to be shown as supported until wired. |
| 16 | الاسترجاع | Item-level refund, reason, return method and manager threshold approval | `RefundWorkspace.tsx` lists eligible cash payments for the authenticated device's open shift; refund API records payment-level adjustment, drawer movement, accounting journal, order event and audit event | **Exists / partial.** Manager-permission cash payment-level refunds with reason/idempotency are wired. Non-cash refunds remain blocked until verified provider adjustment support. Item-level returns remain intentionally deferred until immutable sale-time discount/tax allocations and returned-quantity constraints exist; see `adr-item-level-refund-allocations.md`. |
| 17 | الطلبات | Searchable order list, channels, cashier, amount and status | `RealPosApp.tsx` lists recent local orders; call-center/dispatch use order tables | **Exists / partial.** Not a full order-management/history screen; add branch-scoped filters and order details. |
| 18 | حركات الدرج | Cash balance, sales, expenses, refunds and cash movement ledger | `RealPosApp.tsx` has cash-drawer reconciliation but no dedicated ledger screen | **API only / missing UI** per app map. Build immutable movement history and reconciliation view. |
| 19 | التوصيل | Dispatch board, delivery SLA, courier assignment and statuses | `OperationalWorkspace` loads `operations/dispatch/orders` into a generic table | **Exists / partial.** Dedicated board, courier availability, assignment and timeline are missing. |
| 20 | دورة الأعمال | Business-day lifecycle, branch/shift status, pending operations and connected branches | `SettingsWorkspace` supports starting a new operational cycle; management view is generic | **Exists / partial.** Add cross-branch business-cycle board and guarded transitions. |
| 21 | الطابعات | Printer registry, station mapping, connection/health and paper state | POS print-job worker and Tauri print path exist; no printer settings screen found | **API/runtime only / missing UI.** Build device/printer configuration and diagnostics. |
| 22 | مراجعة المزامنة | Pending/rejected/review-required operations with resolution actions | Sync worker and kitchen sync metadata exist; no dedicated sync-review workspace found | **Exists in engine / missing UI.** Build review queue; never silently retry or mutate financial outcomes. |
| 23 | الصالة والطاولات | Branch table/zone configuration and table states | `DiningArea`/`DiningTable` schema, migration `0033_dining_tables`, RLS policies, `DiningService`, permissions and `DiningWorkspace.tsx` | **Exists / partial.** Branch/tenant scoping and audit-safe transitions are implemented; add full zone configuration parity and end-to-end offline acceptance. |
| 24 | إدارة المنيو | Product/category/branch price management | `RealPosApp.tsx` loads local menu; menu backend supports modifier groups/options; no full catalog management UI found | **API only / missing UI** per app map. Build catalog CRUD, branch pricing, modifier editor and lifecycle. |
| 25 | عرض المنيو | Configure cashier-facing product card presentation (image/icon/text/category) | No matching menu-display configuration screen found | **Design only / missing.** Add presentation configuration separately from product pricing/catalog. |
| 26 | المستخدمون | User list, roles, branches and permission matrix | Login workspace list exists; no user/role administration screen found | **Design only / missing.** Implement tenant/branch-safe user administration and permission matrix. |
| 27 | الأجهزة والفروع | Branch/device registry, versions, last-seen and device status | Login accepts branch/device values; bootstrap and runtime identity exist; no admin registry screen found | **Design only / missing UI.** Device enrollment and branch/device management must share one trusted identity model. |
| 28 | سجل التدقيق | Searchable immutable audit log with risk filters | Audit/security backend foundation may exist; no audit-log screen found | **API only / missing UI** per app map. Verify event coverage before exposing the audit explorer. |
| 29 | المخزون | Stock balances, transfers, receiving, counts and reorder levels | `InventoryWorkspace.tsx` has ingredients, suppliers, receiving, adjustments and transfers | **Exists / partial.** Align layout and add missing reference tabs/states (counting, in-transit, reorder/low-stock). |
| 30 | المحاسبة | Journal entries, fiscal periods, reports and balanced status | `AccountingWorkspace.tsx` has chart of accounts, journals, periods and financial reports | **Exists / partial.** Visual parity, period workflows and full acceptance remain. |
| 31 | الموارد البشرية | Employees, attendance, payroll and branch context | `HrWorkspace.tsx` has employee, attendance and payroll workflows | **Exists / partial.** Align tabs, approval states and design; validate end-to-end payroll/attendance. |
| 32 | التقارير | Sales/performance periods, KPIs, cashier and branch reports | Accounting has detailed financial reports; no dedicated business reports route found | **Design only / missing.** Add operational reporting screen using verified branch-scoped endpoints. |

## 3. Current code reality

Inspected desktop entry points and modules:

- `App.tsx` composes the login gate and workspace router.
- `LoginGate.tsx` provides username/password login and a nine-workspace selector. It is not the reference PIN/device-registration flow.
- `RealPosApp.tsx` contains the strongest existing operational slice: local cart, checkout persistence, shifts, cash-drawer reconciliation, recent local orders, printing and sync workers.
- `KitchenDisplay.tsx` is a dedicated kitchen screen with ticket state and sync/offline handling. Product kitchen stations are now returned by the menu API, persisted in an additive SQLite table for existing installs, and used to route local kitchen print jobs; missing legacy station data safely falls back to KITCHEN.
- `WorkspaceRouter.tsx` routes POS, Kitchen, HR, Accounting, Inventory, Settings; Call Center, Dispatch and Management share a generic operational workspace. POS now opens the API-backed `DiningWorkspace.tsx` from its sidebar.
- `InventoryWorkspace.tsx`, `AccountingWorkspace.tsx`, and `HrWorkspace.tsx` are real API-connected screens, but their current styling and composition do not match the reference.
- `DiningWorkspace.tsx` and `RefundWorkspace.tsx` are API-connected POS overlays. Dining mutations are branch-scoped and audited; refund UI currently exposes cash-only payments on the same device's open shift.
- `real-pos.css` uses Inter/system fonts and a generic dark palette. `styles.css` also uses Inter/system fonts and a different generic palette. Neither is the reference design system.

## 4. Implementation sequence

### Batch A — foundations and high-frequency cashier flow
1. Introduce shared design tokens, IBM Plex Sans Arabic, RTL layout primitives, navigation, branch/device/session header, reusable tables, status badges, dialogs and form controls.
2. Rebuild the login/device identity boundary without pretending PIN authentication exists. Keep the current credential API until a dedicated PIN backend contract is implemented.
3. Rework POS day/night shell, categories/product cards/cart, order-type selection and collection states while retaining tested cart/checkout/SQLite/sync logic.
4. Add open/close shift screens and enforce pending-sync and cash-variance gates in the UI and backend contract.
5. Add dining room/table selection, clear-table manager approval, and order linkage. A first API-backed implementation now exists: tenant/branch-scoped areas and tables, optimistic versions, order seating, manager-only clear-to-cleaning, and audit events. Remaining: reference visual parity, cashier-to-manager credential approval, kitchen-ticket cancellation coupling, and offline/LAN coordination.

### Batch B — kitchen, order lifecycle and cash controls
6. Finish Kitchen Display parity: station/status layout, elapsed-time cues and send-lock behavior; the existing offline-capable `KitchenDisplay.tsx` is now accessible directly from the cashier sidebar and keeps its local queue/conflict reconciliation.
7. Checkout sync materializes station-specific kitchen tickets atomically from server-owned product routing; local printing follows the cached product station, including BEVERAGE and PACKING printer mappings. Added PostgreSQL integration coverage that stages an order, two line items, KITCHEN + BEVERAGE tickets, ticket items and payment, then forces a late failure and verifies the entire set rolls back. This validates database transaction atomicity; a full HTTP/device offline-replay E2E remains outstanding.
7. Add orders/history, refund approval and cash-drawer movement screens.
8. Add sync review with explicit conflict/rejection resolution; never treat a retry as a financial settlement.

### Batch C — branch and enterprise workspaces
9. Add dispatch board, call-center order handling, branch live overview and management control center.
10. Add menu/catalog/pricing, table configuration, menu presentation, users/permissions, devices/branches, printer settings and audit log.
11. Bring Inventory, Accounting and HR to reference parity and finish Reports.
12. Run workflow-level tests and visual parity checks for all 32 reference artifacts.

## 5. Non-negotiable implementation constraints

- Keep all work on `feat/recovery-integration` and PR #13 (or a child feature branch that targets it); do not merge to `main`.
- Preserve current business logic and offline persistence while replacing presentation.
- No fake UI actions: every visible control must be wired or explicitly disabled/marked unavailable.
- Do not hardcode sample metrics or branch names as production data.
- Server remains authoritative for pricing, taxes, service fees, discount policy, manager approvals, tenant/branch scope and financial settlement.
- Refunds, table clearing, cash movements, journal posting and sync conflict resolution must be permission-gated and audited.
- No production migrations, live payment activation, deployment, or destructive database operations as part of visual parity work.
- A green CI result applies only to the exact SHA tested; obtain fresh checks after every implementation batch.

## 6. First implementation target

Start with a shared design-system layer and the cashier journey (login shell → open shift → POS day/night → dining/table → collection → close shift). Do not publish a review URL until this batch is coherent, built, tested, and visually checked against the uploaded reference. The previously generated old-UI preview is not an approved review target.


### Kitchen API RLS hardening (2026-11-19)
- Found and fixed missing transaction-local RLS context in KitchenService list/listTickets/materialize/transition paths and KitchenSyncService idempotency/read/write paths.
- Kitchen operations now set tenant, branch, user and session context inside each database transaction before protected tables are accessed.
- Added unit assertions that the transaction-local RLS context is applied before ticket state changes and sync persistence.
