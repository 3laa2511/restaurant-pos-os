# Phase 0 — Repository review findings

Branch: `fix/review-phase-0`
Base: `feat/hr-accounting-inventory`
Pull request: [#4](https://github.com/3laa2511/restaurant-pos-os/pull/4)

## F-00a — Dependency lockfile and reproducibility

**Status: IMPLEMENTED ON BRANCH / FROZEN-INSTALL CI PENDING**

Evidence and changes:
- Root `package.json` pins `pnpm@10.15.0` and requires Node `>=22.0.0`.
- The lockfile was generated from all four workspace projects and committed to this branch by the temporary bootstrap workflow.
- Fixed the bootstrap workflow's first-run detection: `git diff` misses untracked files, so it incorrectly reported no changes after generating a new lockfile. It now checks `git status --porcelain`.
- Both API and desktop quality workflows now use `pnpm install --frozen-lockfile`.

Remaining validation:
- Confirm the API and desktop CI runs pass with frozen installs on the latest branch head.
- Remove the temporary bootstrap workflow after the committed lockfile is verified, so routine dependency changes remain deliberate code-review changes rather than workflow-generated commits.

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

**Status: IMPLEMENTED ON BRANCH / CI PENDING**

Changes on this branch:
- Added `@restaurant-pos/payment-policy` as a workspace package with explicit ESM and TypeScript declaration exports.
- Moved the framework-independent payment validation and cash-change logic into `packages/payment-policy/src/index.mjs`.
- Added Node test coverage for positive cash payments, non-cash references, invalid amounts, and cash change.
- The API keeps a compatibility re-export from its previous module path, while desktop imports the shared package directly.
- Added the workspace dependency to both the API and desktop package manifests.

Remaining validation:
- Wait for the branch's API and desktop CI workflows to complete.
- Confirm package tests, API typecheck/tests, desktop typecheck/tests, and frontend build all pass before treating this finding as resolved.

Risk addressed by the change: desktop no longer imports implementation source from inside the API package. The finding remains pending CI until the new workspace package is verified end to end.

## CI execution blocker — runner/log visibility

**Status: CONFIRMED / ROOT CAUSE UNKNOWN**

Observed on 2026-10-14 and rechecked 2026-10-15:
- Bootstrap run: [38564434988](https://github.com/3laa2511/restaurant-pos-os/actions/runs/38564434988), job ID `115853391659`, conclusion `failure`, zero reported steps.
- Desktop run: [38564434934](https://github.com/3laa2511/restaurant-pos-os/actions/runs/38564434934), job ID `115853391381`, conclusion `failure`, zero reported steps.
- PR-triggered runs for API [38565220926](https://github.com/3laa2511/restaurant-pos-os/actions/runs/38565220926), Desktop [38565220598](https://github.com/3laa2511/restaurant-pos-os/actions/runs/38565220598), and bootstrap [38565220824](https://github.com/3laa2511/restaurant-pos-os/actions/runs/38565220824) all report `startup_failure`.
- Recheck on commit `739814b15f05921303c26b1f9171f6e1b5eacf20` found newer runs on 2026-10-15: bootstrap [38640285188](https://github.com/3laa2511/restaurant-pos-os/actions/runs/38640285188), API [38640283866](https://github.com/3laa2511/restaurant-pos-os/actions/runs/38640283866), and Desktop [38640282421](https://github.com/3laa2511/restaurant-pos-os/actions/runs/38640282421); all three again report `startup_failure`. Job listing returned an empty array for the API and Desktop runs.
- Retrying the failed API and Desktop runs through the available GitHub action returned HTTP 403, `This workflow run cannot be retried`. This is an additional observed limitation, not evidence of the underlying startup cause.
- Latest job lookup for API and Desktop returned empty job arrays; earlier step/log lookup returned no steps and `BlobNotFound`.
- This affects three distinct workflows before any steps are exposed. Root cause remains unknown; repository settings, billing/usage, runner provisioning, or a GitHub-side startup issue still need verification.

This does not prove a code or YAML defect. Verify repository Actions policy, runner availability, and usage/billing restrictions in GitHub settings before attributing the failure to source code. Do not treat an empty step list as a passing test.

## Exit criteria

- [ ] Resolve why Actions jobs fail before steps are reported.
- [ ] Generate and commit `pnpm-lock.yaml`; verify a frozen install.
- [ ] Resolve duplicate migration numbering only after checking deployed migration history.
- [ ] Extract payment policy into a shared package and add regression tests.
- [ ] Run API and desktop lint/typecheck/tests, frontend build, and `cargo check`; record actual output.
- [ ] Keep PR draft and do not merge until all checks pass.
