# Recovery Status — 2026-11-06

This document records the active recovery integration branch. Refresh GitHub and the exact commit SHA before relying on this status.

## Integration target

- Repository: `3laa2511/restaurant-pos-os`
- Integration branch: `feat/recovery-integration`
- Latest commit when this status was written: `ec7718bf2f6a809a7ec5a4aa5dde8ac0e7cb922b`
- Target: `main` at `4a81d8dbf6c480cdc5aef27f466de20c93b87985`
- Umbrella PR: #13 (draft, open)
- No changes have been merged into `main` by this recovery work.

## Existing work integrated or carried forward

| Area | Recovery action |
|---|---|
| HR, payroll, raw-material inventory and accounting foundation | Carried forward from PR #3 |
| Product identity and dependencies | Corrected login branding to RPOS; added pnpm lockfile and frozen installs |
| Workspace visibility | Added capability matrix distinguishing full, partial, read-only and placeholder surfaces |
| Tauri database surface | Added a first-pass call-site inventory; it is explicitly not exhaustive |
| Shared payment rules | Added framework-independent payment-policy workspace package |
| Kitchen / local orders | Integrated repository-based conflict persistence and recent-order query helper |
| Tenant / branch security | Integrated branchless-role scope checks and regression tests; a tenant-wide owner may select only a branch queried within that tenant |
| Offline sync | Added an authentication-required state that releases the current queue lease without consuming retry budget; preserved sequence, bounded retry and stale-lease fencing behavior |
| Payment Hub | Integrated provider-neutral payment intent policy, provider accounts, attempts and webhook inbox schema/RLS work |
| Provider callbacks | Integrated a provider-neutral adapter contract; no real provider is configured and no callback settles orders or posts accounting |
| RLS verification | Added Prisma migration provider lock and separated rejected SQL assertions into independent transactions |
| Engineering workflow | Integrated Replica-derived recon/build/test/parity/quality-gate documentation |
| Local developer experience | Added API start/build/migrate scripts, Vite CORS defaults, and a first-run owner/tenant/branch/device bootstrap |

## Latest validation state

GitHub Actions validation for exact integration SHA `ec7718bf2f6a809a7ec5a4aa5dde8ac0e7cb922b`:

- API Quality Gate: **success**. PostgreSQL startup, migration deployment, RLS test-role grants, Prisma generation, typecheck, NestJS build, bootstrap script syntax, shared payment-policy tests, and API unit/integration tests passed.
- POS Desktop Quality Gate: all validation steps passed, including API lint/typecheck/tests, desktop lint/typecheck, sync queue tests, frontend build, and Tauri native check. The workflow was still completing post-job cleanup when this status was updated.

The next code change creates a new SHA and must receive fresh CI. Do not carry this green result forward to later commits.

## Known product gaps — not declared complete

- The FlutterFlow source export and the 32-page Claude UI Directions PDF are not in the inspected repository tree. Exact design parity cannot be verified.
- Login exposes nine workspaces, but a workspace selector does not prove each workspace has complete screens, API wiring, permissions, and end-to-end behavior. HR, Accounting and Inventory still require full workflow verification and UI work; other workspaces also need acceptance testing.
- The current POS desktop Vite preview is not a signed Windows installer.
- Per-workstation SQLite does not coordinate multiple cashiers during a full branch internet outage. The branch-LAN coordination service and shared offline model remain required.
- The generic Tauri SQL bridge still needs a complete caller inventory and staged typed-command migration.
- Production provider verification, automatic payment settlement, accounting posting from asynchronous payment events, production migrations, hosting, secrets, monitoring, backup/restore drills and deployment are not complete.
- Duplicate migration prefixes exist (including 0025 and 0028). No historical migration was renamed. A production-safe resolution requires checking every deployed database's migration history first.

## Safety boundaries

- Keep the integration work on `feat/recovery-integration` and PR #13 until all required checks and reviews pass.
- Do not push or merge directly to `main`.
- Do not run production migrations, enable live providers, or deploy without explicit approval.
- A provider event may change a verified payment intent; it must not directly close an order, post accounting, consume inventory, or mutate a cash drawer.
- Never treat screenshots, customer-submitted references, or arbitrary SMS text as proof of payment.


## Additional branch review

- `feat/tenant-catalog-foundation` is an ancestor of `feat/hr-accounting-inventory`; its tenant-scoped catalog foundation is included through PR #3.
- `refactor/kitchen-conflict-repository` (closed PR #8) is superseded by the later kitchen repository work carried in PR #9.
- `feat/print-lifecycle` is an older branch with an obsolete App.tsx shape. The current integration already has the Tauri print command, print worker runtime and lease heartbeat; the old App.tsx was not copied.
- `backup/menu-variants-2026-09-16` was reviewed but not copied. Its migration uses the already-occupied `0008` prefix and its variant/modifier tables lack tenant ownership and same-tenant relational constraints. The menu API also does not carry variant/modifier selections into order pricing snapshots. Reimplement this as a new tenant-safe migration and complete vertical slice; do not cherry-pick the old migration.
- `reconcile/staging-migration-recovery-2026-09-19` is a separate historical Supabase migration stream with a different schema/backend from the current Prisma/PostgreSQL app. Do not merge its Supabase migrations or staging workflow into this codebase. Reuse only generic lessons after a specific need is established.
- `test/rls-ci-check` points at the current main baseline and contains no additional feature work.
