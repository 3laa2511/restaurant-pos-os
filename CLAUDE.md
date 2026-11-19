# Restaurant POS OS — Engineering Guardrails

These instructions apply to every AI-assisted change in this repository.

## Project identity and scope

- This repository is **Restaurant POS OS** only. Do not mix in Mashwar, Bo'sh Store, AZZAZI marketing-site work, or unrelated projects.
- Product scope includes branch POS, central call center, kitchen operations, delivery dispatch, payments and cashier shifts, inventory, offline-first synchronization, thermal printing, RBAC, auditability, and Arabic/English RTL/LTR support.
- Treat the repository and its checked-in documentation as the source of truth. Conversation history is context, not a substitute for inspecting current code and CI.

## Git and change control

- Never push changes directly to `main`.
- Inspect the current default branch, open PRs, relevant branches, and CI before starting work.
- Create a focused branch from the correct current base. Do not silently base work on a stale local snapshot.
- Prefer one coherent, dependency-ordered batch over repeated fragmented patches.
- Open a PR with scope, rationale, risk, files changed, validation evidence, and explicit non-goals.
- Do not merge a PR or enable auto-merge unless the user explicitly asks.
- Do not rewrite, close, or modify another open PR as a side effect of unrelated work.

## Engineering discipline

- Follow **build → verify → diagnose → fix → verify again**. Never guess at CI failures.
- Read the actual failing command and logs before proposing a fix.
- Do not add new product features while required CI gates are failing.
- Preserve the existing stack and conventions unless a documented ADR and evidence justify a change. Current repository signals include pnpm workspaces, Node.js 22+, TypeScript, a NestJS API, Prisma/PostgreSQL, and a Tauri/React desktop app with local SQLite.
- Keep business rules in testable domain/policy layers; keep UI components thin.
- Prefer explicit state machines, idempotent commands, transactional invariants, and auditable sensitive actions.
- Avoid unnecessary abstractions, duplicate helpers, speculative refactors, and unrelated formatting churn.

## Data, security, and operations

- Never run production migrations, destructive database commands, production deployments, or live payment actions without explicit user approval.
- Never commit secrets, tokens, credentials, private customer data, or real payment details. Keep `.env.example` value-free.
- Authorization must be enforced server-side and tested across tenant, company, branch, role, and record ownership boundaries as applicable.
- Treat offline queues, idempotency keys, retry counts, sequence ordering, and sync conflict handling as data-integrity contracts.
- Treat payment success as untrusted until verified provider evidence is authenticated and reconciled. Never settle an asynchronous payment from a client-side success screen alone.
- Sensitive diagnostics must be read-only by default. Recovery actions require a preview, explicit authorization, audit record, and safe rollback strategy.

## Definition of done

A change is not complete because code was written. Completion requires:
1. Requirements and affected flows identified.
2. Relevant implementation and dependencies inspected.
3. Tests added or updated for changed behavior and important failure paths.
4. Required typecheck, lint, tests, build, and applicable native/database checks executed.
5. Actual command results recorded; skipped checks are explicitly marked.
6. Security, migration, offline/sync, and regression impact assessed.
7. Documentation and project decision records updated where behavior or architecture changed.
8. PR description matches the actual diff and does not overstate validation.

When evidence is missing, report the work as partial—not done.
