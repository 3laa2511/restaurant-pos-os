---
name: pos-engineering-workflow
description: Safely audits, plans, implements, verifies, and reviews Restaurant POS OS changes, including payments, inventory/accounting, offline sync, security, UI wiring, and release readiness.
---
# POS Engineering Workflow
This project skill supplements upstream Replica skills. Root CLAUDE.md and docs/engineering are binding.

## Mandatory start
1. Read CLAUDE.md, docs/engineering/WORKFLOW.md, and docs/engineering/QUALITY_GATES.md.
2. Refresh branch, main SHA, open PRs, relevant branch heads, and CI.
3. Treat PROJECT_BASELINE.md as historical; verify time-sensitive details.
4. Inspect existing code, tests, migrations, and docs before proposing abstractions.
5. Retrieve prior referenced plans/files rather than guessing.

## Project-specific checks
- Payments: separate cash settlement from asynchronous provider intents/events. Require authenticated provider evidence, exact minor-unit amount/currency, receiving account, transaction identity, tenant/order match, idempotency, terminal-state protection. Never trust client success UI.
- Offline sync: preserve sequence, idempotency, pending/claimed/failed semantics, auth-required pauses; distinguish transport/auth failures from business rejection.
- Inventory/accounting: inspect journal posting and branch/company attribution; reconciliation read-only unless approved correction workflow exists.
- Authorization: derive identity, role, workspace, company, branch from trusted server context; test cross-tenant/branch denial.
- Desktop: assess local SQLite and server behavior.
- UI: map each screen/action to a real domain/API path; cover loading/empty/error/offline/forbidden/conflict and Arabic/English RTL/LTR.

## Execution
A. Discover actors → screens → commands/API → policies → persistence → events/audit → sync/print/provider. Separate facts, assumptions, unknowns.
B. Plan impacted files, invariants, dependencies, tests, migration risk, rollback, acceptance. Write ADR for architectural changes.
C. Implement dependency-first, focused scope. No main pushes; no production migration/deploy without approval.
D. Verify focused tests then repository gates. Record command, SHA, environment, result, skipped checks. Read exact CI logs.
E. Review acceptance, security, finance/data integrity, offline behavior, regressions, observability, docs.
F. Report actual changes/tests, blockers, and next dependency-ordered step. Code generation alone is not completion.

## Artifacts
Use replica/ for task recon, feature matrix, test plan, parity, build log. Keep durable decisions in docs/decisions/ and engineering rules in docs/engineering/. Never overwrite existing project docs.
