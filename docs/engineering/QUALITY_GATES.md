# Quality Gates

A gate is a stop/go decision backed by reproducible evidence. A screenshot does not prove backend correctness; a unit test does not prove tenant isolation; a successful build does not prove migration safety.

## Gate 0 — Scope and baseline
- Record base branch/SHA, open PRs, relevant CI, actor, workspace, company/branch scope, acceptance criteria, non-goals, and risk class.
- Identify affected UI, API, policies, persistence, events, sync, printing, and providers.
- Stop if money, permissions, inventory, accounting, or ownership requirements are ambiguous.

## Gate 1 — Static quality and build
- Install from the lockfile with the repository package manager.
- Run relevant typecheck, lint, tests, builds, and Tauri/native checks when affected.
- Stop on required failures; diagnose exact logs before adding features.

## Gate 2 — Authorization and tenant isolation
- Enforce authorization server-side using trusted session context.
- Validate company, branch, workspace, role, and record ownership.
- Test both allowed and denied access, including cross-tenant/branch attempts.
- Keep RLS and application authorization consistent.

## Gate 3 — Data and accounting integrity
- Review transactions, constraints, uniqueness, indexes, money precision, inventory movements, journal posting, migration/backfill/rollback and compatibility.
- Store money in integer minor units with explicit currency.
- Keep reconciliation read-only unless an approved correction workflow exists.
- Stop if balances, ownership, posting semantics, or recovery are unclear.

## Gate 4 — Offline and synchronization
- Test sequence ordering, idempotency across retries, duplicate delivery, out-of-order events, partial batches, conflicts, authentication pauses, and business rejections.
- Distinguish transport/auth failures from permanent business rejection.
- Stop if a command can be lost, duplicated, reordered, or silently marked complete.

## Gate 5 — Payments
- Separate pending intent from settled payment.
- Verify provider signature server-side, transaction identity, exact minor-unit amount, currency, receiving account, tenant/order/intent match, idempotency, and terminal-state protection.
- Ambiguous transfers go to manual reconciliation; client UI, screenshots, or fuzzy matching never settle payments.
- Keep synchronous cash settlement separate from asynchronous provider settlement.

## Gate 6 — UX and operations
- Check loading, empty, success, error, forbidden, offline, and conflict states.
- Every visible action must be wired or disabled with an explanation.
- Check Arabic/English, RTL/LTR, keyboard/focus, responsive behavior, handoffs, printing, and audited reprints.

## Gate 7 — Release
- Required CI green on exact release SHA; no open critical/high security or integrity defects.
- Review migration/recovery, backup restore, secrets, monitoring, alerts, and runbooks.
- Explicit user approval required before production migrations, live payment activation, or deployment.

## Evidence record
| Commit / PR | Gate | Command / scenario | Environment | Result (pass/fail/skipped) | Log/evidence | Follow-up |
|---|---|---|---|---|---|---|

Skipped is not passed. A failed gate blocks dependent work.