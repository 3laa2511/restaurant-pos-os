# Phase 0 — Repository review findings

Branch: `fix/review-phase-0`
Base: `feat/hr-accounting-inventory`
Pull request: [#4](https://github.com/3laa2511/restaurant-pos-os/pull/4)

## F-00a — Dependency lockfile and reproducibility

**Status: IMPLEMENTED ON BRANCH / FROZEN-INSTALL CI PASSED**

Evidence and changes:
- Root `package.json` pins `pnpm@10.15.0` and requires Node `>=22.0.0`.
- The lockfile was generated from all four workspace projects and committed to this branch by the temporary bootstrap workflow.
- Fixed the bootstrap workflow's first-run detection: `git diff` misses untracked files, so it incorrectly reported no changes after generating a new lockfile. It now checks `git status --porcelain`.
- Both API and desktop quality workflows now use `pnpm install --frozen-lockfile`.

Validation on branch head `5e015cc7d28998483bfec87b09b8b2aef9043414` (2026-10-28): API and Desktop quality workflows both completed successfully, including dependency installation with `pnpm install --frozen-lockfile`.

Safety note:
- The temporary bootstrap workflow has been removed after generating the lockfile. It had `contents: write` permission and was only intended to bootstrap this one-time file; normal CI should not create commits automatically.

Risk addressed: CI now has a committed dependency graph and is configured to fail when package manifests drift from the lockfile. Do not mark resolved until the frozen-install runs complete successfully.

## F-00b — Duplicate Prisma migration sequence number

**Status: DUPLICATE PREFIX CONFIRMED / RUNTIME FAILURE NOT ESTABLISHED**

Evidence:
- `prisma/migrations/0025_accounting_fiscal_periods/migration.sql`
- `prisma/migrations/0025_settings_workspace/migration.sql`
- Subsequent migrations include `0026_normalize_initial_fiscal_period`, `0027_accounting_journal_immutability`, and `0028_inventory_receipt_idempotency`.
- Prisma migration directories are ordered by their full directory names; the current names sort lexicographically as accounting fiscal periods, then settings workspace, then `0026`. Both `0025` migrations therefore sort before `0026` in the current repository.

Risk: duplicate numeric prefixes are confusing for human review and external tooling that assumes a unique numeric sequence. The duplicate prefix alone is not proof of a Prisma execution-order failure in this repository.

Safety constraint: do not rename or delete either migration until the target database's `_prisma_migrations` history and deployment status are verified. If either migration has been applied, use a documented forward-only reconciliation plan; do not rewrite deployed history.

## F-00c — Desktop imports API implementation source directly

**Status: IMPLEMENTED ON BRANCH / CI PASSED**

Changes on this branch:
- Added `@restaurant-pos/payment-policy` as a workspace package with explicit ESM and TypeScript declaration exports.
- Moved the framework-independent payment validation and cash-change logic into `packages/payment-policy/src/index.mjs`.
- Added Node test coverage for positive cash payments, non-cash references, invalid amounts, and cash change.
- The API keeps a compatibility re-export from its previous module path, while desktop imports the shared package directly.
- Added the workspace dependency to both the API and desktop package manifests.

Validation on branch head `5e015cc7d28998483bfec87b09b8b2aef9043414` (2026-10-28): API and Desktop quality workflows both completed successfully. The shared `@restaurant-pos/payment-policy` test step passed in both workflows; the full workflows also passed.

Risk addressed by the change: desktop no longer imports implementation source from inside the API package. The finding remains pending CI until the new workspace package is verified end to end.

## F-00d — Workspace UI/API capability gap

**Status: CONFIRMED IN CURRENT ROUTER / FEATURE COMPLETENESS NOT ESTABLISHED**

Evidence inspected on `feat/hr-accounting-inventory`:
- `apps/pos-desktop/src/WorkspaceRouter.tsx` routes HR, Accounting, and Inventory to `ReadWorkspace`, which only issues GET requests (`hr/employees`, `accounting/trial-balance`, `inventory/stock`) and renders data tables.
- Call Center and Dispatch route to `OperationalWorkspace`, which only loads order lists; Management loads a compact overview of branches, customers, and order status counts.
- The login selector describes broader functions (attendance, payroll, purchasing, reports, inventory receiving/recipes) than the corresponding current screen exposes.
- API controllers include additional HR and Accounting operations, so a read-only UI does not imply the backend capability is missing.

Impact: product scope shown at login exceeds what these current screens allow users to do. This is a UI integration/completeness gap, not proof that backend endpoints are absent.

Next action:
1. Create a screen-to-endpoint capability matrix for HR, Payroll, Accounting, Inventory, Call Center, Dispatch, and Management.
2. Map each required operation to an existing permission-protected API endpoint and an integration test.
3. Implement one workspace at a time; do not add UI controls until request DTOs, permission requirements, branch scoping, and success/error behavior are verified.
4. Update login descriptions to distinguish available read-only screens from planned functionality until those operations are implemented.

## F-00e — Renderer can issue arbitrary local SQL through Tauri commands

**Status: COMMAND SURFACE CONFIRMED / EXPLOITABILITY DEPENDS ON RENDERER TRUST BOUNDARY**

Evidence inspected on `feat/hr-accounting-inventory`:
- `apps/pos-desktop/src/pos/tauri-bridge.ts` exposes generic `execute(sql, params)`, `query(sql, params)`, and `transaction(statements)` methods.
- `apps/pos-desktop/src-tauri/src/lib.rs` registers `db_execute`, `db_query`, and `db_transaction` as Tauri commands and prepares the caller-supplied SQL without a table/statement allowlist.
- SQL parameters are bound, which helps prevent value interpolation, but does not constrain which statements or tables the renderer can request.

Impact: any compromised or unintended renderer code that can invoke these commands can read or mutate the local SQLite database beyond the intended repository operations. This is a broad trust-boundary capability and should be treated as a high-priority hardening item before production distribution.

Next action:
1. Inventory every frontend call site and SQL statement; classify required reads/writes by domain.
2. Replace generic commands with typed, narrowly scoped Tauri commands/repository operations (for example checkout persistence, sync queue, shift reconciliation, and print queue).
3. Keep parameter binding and transactions internally; do not accept arbitrary SQL strings from the renderer.
4. Add tests that prove each command only performs its intended operation and that unapproved table/statement access is unavailable.
5. Keep migrations and local schema evolution inside the Rust/data layer; do not expose migration execution to the UI.

Safety note: this finding documents an exposed command surface, not evidence of an actual compromise. Do not remove or restrict commands blindly before enumerating callers, because that could break checkout, offline sync, or shift reconciliation.

## F-00f — Product branding mismatch in login screen

**Status: CONFIRMED**

Evidence:
- `apps/pos-desktop/src/LoginGate.tsx` labels the application `BO'SH` and `BO'SH SYSTEM`, while the application shell and repository identify the product as Restaurant POS OS.

Impact: confusing product identity and accidental carryover of branding from another product.

Next action: replace the login branding with Restaurant POS OS branding and add a lightweight regression check or documented manual verification. Keep brand assets/configuration centralized so future rebranding does not require editing multiple screens.

## CI execution blocker — runner/log visibility

**Status: HISTORICAL INCIDENT / CURRENTLY NOT REPRODUCED**

Observed on 2026-10-14 and rechecked 2026-10-15:
- Bootstrap run: [38564434988](https://github.com/3laa2511/restaurant-pos-os/actions/runs/38564434988), job ID `115853391659`, conclusion `failure`, zero reported steps.
- Desktop run: [38564434934](https://github.com/3laa2511/restaurant-pos-os/actions/runs/38564434934), job ID `115853391381`, conclusion `failure`, zero reported steps.
- PR-triggered runs for API [38565220926](https://github.com/3laa2511/restaurant-pos-os/actions/runs/38565220926), Desktop [38565220598](https://github.com/3laa2511/restaurant-pos-os/actions/runs/38565220598), and bootstrap [38565220824](https://github.com/3laa2511/restaurant-pos-os/actions/runs/38565220824) all report `startup_failure`.
- Recheck on commit `739814b15f05921303c26b1f9171f6e1b5eacf20` found newer runs on 2026-10-15: bootstrap [38640285188](https://github.com/3laa2511/restaurant-pos-os/actions/runs/38640285188), API [38640283866](https://github.com/3laa2511/restaurant-pos-os/actions/runs/38640283866), and Desktop [38640282421](https://github.com/3laa2511/restaurant-pos-os/actions/runs/38640282421); all three again report `startup_failure`. Job listing returned an empty array for the API and Desktop runs.
- Retrying the failed API and Desktop runs through the available GitHub action returned HTTP 403, `This workflow run cannot be retried`. This is an additional observed limitation, not evidence of the underlying startup cause.
- Latest job lookup for API and Desktop returned empty job arrays; earlier step/log lookup returned no steps and `BlobNotFound`.
- This affects three distinct workflows before any steps are exposed. Root cause remains unknown; repository settings, billing/usage, runner provisioning, or a GitHub-side startup issue still need verification.

These October 14–15 failures were startup failures without exposed job steps; the underlying cause was not established. On 2026-10-28, the latest API and Desktop workflows completed successfully on the current branch head, so the earlier blocker is not currently reproduced. This does not establish the historical root cause; monitor future runs and investigate again if startup failures recur. Do not treat an empty step list as a passing test.

## Exit criteria

- [x] Commit `pnpm-lock.yaml` and verify frozen installs in both latest workflows.
- [ ] Resolve duplicate migration numbering only after checking deployed migration history; no database history has been inspected, so no rename/rewrite is authorized.
- [x] Extract payment policy into a shared package and add regression tests; latest API and Desktop quality workflows pass.
- [x] Run the latest API and Desktop quality workflows successfully on branch head `5e015cc7d28998483bfec87b09b8b2aef9043414` (includes the configured lint/typecheck/tests/build/native checks).
- [x] Historical runner startup failure is not reproduced in latest runs; root cause of the earlier incident remains unknown.
- [x] Keep PR draft and do not merge until the remaining migration-history question and broader product audit are addressed.
