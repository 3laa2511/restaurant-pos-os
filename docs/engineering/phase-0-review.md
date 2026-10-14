# Phase 0 — Repository review findings

Branch: `fix/review-phase-0`
Base: `feat/hr-accounting-inventory`
Pull request: [#4](https://github.com/3laa2511/restaurant-pos-os/pull/4)

## F-00a — Dependency lockfile and reproducibility

**Status: CONFIRMED / NOT FIXED**

Evidence:
- Root `package.json` declares `packageManager: pnpm@10.15.0` and Node `>=22.0.0`.
- `pnpm-workspace.yaml` includes `apps/*`, `packages/*`, and `services/*`.
- No `pnpm-lock.yaml` was present on this branch at review time.
- `.github/workflows/api-quality.yml` and `.github/workflows/pos-desktop.yml` install with `pnpm install --no-frozen-lockfile`.

Risk: CI may resolve different dependency graphs over time and cannot enforce frozen-lockfile reproducibility.

Safe resolution: generate the lockfile using the pinned pnpm version, review the resulting diff, then switch CI to frozen installs. Do not claim this is fixed until the lockfile exists and clean installs pass.

## F-00b — Duplicate Prisma migration sequence number

**Status: CONFIRMED / NOT FIXED**

Evidence:
- `prisma/migrations/0025_accounting_fiscal_periods/migration.sql`
- `prisma/migrations/0025_settings_workspace/migration.sql`
- Subsequent migrations include `0026_normalize_initial_fiscal_period`, `0027_accounting_journal_immutability`, and `0028_inventory_receipt_idempotency`.

Risk: duplicate numeric prefixes make migration ordering ambiguous across tooling and human review.

Safety constraint: do not rename or delete either migration until the target database's `_prisma_migrations` history and deployment status are verified. If either migration has been applied, use a documented forward-only reconciliation plan; do not rewrite deployed history.

## F-00c — Desktop imports API implementation source directly

**Status: CONFIRMED / NOT FIXED**

Evidence:
- `apps/pos-desktop/src/pos/checkout.ts` imports `PaymentInput`, `PaymentMethod`, `calculateCashChange`, and `validatePayment` from `../../../../services/api/src/modules/payments/payment-policy.js`.
- The API package has `rootDir: src` and NodeNext module resolution in `services/api/tsconfig.json`; the desktop uses ESNext/Bundler resolution.
- The policy implementation lives in `services/api/src/modules/payments/payment-policy.ts`.

Risk: desktop builds depend on API source layout and cross-package TypeScript resolution; this blurs the domain boundary and can break builds during API refactors.

Safe resolution: move the shared, framework-independent payment policy into a dedicated workspace package with explicit package exports and declaration types; update both consumers and add parity tests before removing the API-local implementation. Do not mark resolved until desktop and API typechecks/tests pass.

## CI execution blocker — runner/log visibility

**Status: CONFIRMED / ROOT CAUSE UNKNOWN**

Observed on 2026-10-14:
- Bootstrap run: [38564434988](https://github.com/3laa2511/restaurant-pos-os/actions/runs/38564434988), job ID `115853391659`, conclusion `failure`, zero reported steps.
- Desktop run: [38564434934](https://github.com/3laa2511/restaurant-pos-os/actions/runs/38564434934), job ID `115853391381`, conclusion `failure`, zero reported steps.
- Job-step lookup returned an empty array; log retrieval returned `BlobNotFound`.
- Combined commit status returned no status entries.

This does not prove a code or YAML defect. Verify repository Actions policy, runner availability, and usage/billing restrictions in GitHub settings before attributing the failure to source code. Do not treat an empty step list as a passing test.

## Exit criteria

- [ ] Resolve why Actions jobs fail before steps are reported.
- [ ] Generate and commit `pnpm-lock.yaml`; verify a frozen install.
- [ ] Resolve duplicate migration numbering only after checking deployed migration history.
- [ ] Extract payment policy into a shared package and add regression tests.
- [ ] Run API and desktop lint/typecheck/tests, frontend build, and `cargo check`; record actual output.
- [ ] Keep PR draft and do not merge until all checks pass.
