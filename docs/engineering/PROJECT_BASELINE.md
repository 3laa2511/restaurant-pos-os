# Project Baseline — 2026-11-04

Point-in-time orientation only. Refresh GitHub and source before every task.

## Repository and stack observed
- Repository: `3laa2511/restaurant-pos-os`; default branch `main`.
- Main SHA observed: `4a81d8dbf6c480cdc5aef27f466de20c93b87985`.
- Workflow branch: `docs/replica-engineering-workflow`.
- Tree contained 236 entries at inspection.
- pnpm workspace, pnpm 10.15.0, Node.js >=22, TypeScript.
- API uses NestJS-style modules and Prisma/PostgreSQL.
- Desktop app uses React/Vite/Tauri with local SQLite and offline sync.
- Root scripts expose recursive typecheck, lint, and test.

## Product scope observed in README
Branch POS, central call center, kitchen, delivery dispatch, payments/cashier shifts, inventory foundation, offline-first sync, thermal printing, RBAC/audit, Arabic/English RTL/LTR.

## Existing assets observed
- `docs/ORDER_CORE.md`
- `.github/workflows/pos-desktop.yml`
- API modules include auth, audit, cash drawer, kitchen, menu, orders, payments, printers, shifts, sync.
- Desktop modules include checkout, printing, shifts, local SQLite, sync.
Do not create parallel implementations without inspecting these.

## In-flight work to protect
PR #10, `feat(payments): establish verified Payment Hub foundation`, was open at inspection on `feat/payment-hub-foundation`. Its description scopes provider-neutral intent transition policy and verified success evidence; it states no credentials, production migrations, automatic settlement wiring, or cash-path changes in that PR.

Before payment work: refresh PR state/head/CI; read diff and current payment module; do not assume it merged or passed CI; preserve separation between cash and asynchronous provider settlement.

## Constraints
- No direct pushes to main; focused branches and PRs.
- Build → verify → diagnose → fix → verify.
- Do not add features while required CI is failing.
- No production migrations or deployments without explicit approval.
- Prefer consolidated dependency-ordered batches and evidence-based reports.

## Not verified by this baseline
Current CI state, local working tree, complete PostgreSQL/RLS integration status, full 32-page UI Directions PDF parity, all module completion, and the final payment integration choice. Obtain fresh evidence before deciding.