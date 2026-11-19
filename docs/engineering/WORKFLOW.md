# Engineering Workflow

This workflow adapts the useful parts of the MIT-licensed Replica skill pack to an existing, production-oriented POS platform. It is not a clone-the-original-app process. The goal is safe, maintainable product development with traceable evidence.

## Lifecycle

### 0. Intake and scope
- State the user/business problem, actor, workspace, branch/company scope, and expected outcome.
- Identify affected screens, flows, API modules, tables, background jobs, local desktop behavior, and integrations.
- Define explicit non-goals and acceptance criteria.
- Classify risk: UI-only, domain behavior, authorization, financial, inventory/accounting, offline/sync, migration, or release.

Deliverable: a short change brief with acceptance criteria and risk class.

### 1. Recon and current-state audit
- Inspect the current branch, working tree, open PRs, CI state, docs, relevant source files, tests, and migrations.
- Build a screen/route inventory and end-to-end flow map for the affected area.
- Trace each user action through UI → API/domain policy → persistence → audit/event → sync/print/provider integration.
- Record observed behavior separately from assumptions. Give each finding evidence and confidence.
- For UI parity work, use the supplied 32-page UI Directions PDF and actual project screens as evidence; do not infer missing screens from memory.

Deliverables under `replica/`: `recon.md`, `features.csv`, and relevant evidence references. Do not duplicate or replace existing architecture documents.

### 2. Architecture and impact analysis
- Preserve the current stack unless a justified ADR says otherwise.
- Map affected modules, data ownership, transaction boundaries, tenant/branch context, API contracts, local SQLite behavior, and external providers.
- Identify race conditions, retries, idempotency, ordering, offline behavior, failure recovery, and observability requirements.
- For schema changes, document migration order, backfill, compatibility, rollback, RLS/authorization, and test strategy before implementation.
- Prefer a thin vertical slice that proves the full path over broad disconnected scaffolding.

Deliverable: change plan and, when needed, an ADR under `docs/decisions/`.

### 3. UX and interaction design
- Define screen purpose, navigation entry/exit, permissions, responsive behavior, RTL/LTR, and all relevant states: loading, empty, success, error, offline, forbidden, conflict, and long content.
- Reuse the existing design tokens and components. Do not introduce a second design system.
- Keep accessible labels, keyboard behavior, focus states, and clear financial/status messaging.
- Record UI-only controls and ensure every actionable control is wired to a real supported behavior or explicitly marked as unavailable.

Deliverable: screen/component specification and updated feature matrix.

### 4. Implementation
- Work in dependency order: domain invariants → persistence/API → authorization/audit → desktop/offline integration → UI → documentation.
- Keep changes focused. Avoid unrelated refactors.
- Use explicit domain policies/state transitions and transactional enforcement for critical invariants.
- Preserve backwards compatibility for sync contracts and queued commands.
- Do not use fake data or mocks as proof of production integration. Mocks are acceptable only for isolated unit tests with clear boundaries.

Deliverable: implementation with focused unit, integration, and regression tests.

### 5. Verification and diagnostics
- Run the smallest relevant tests first, then the required repository CI commands.
- Diagnose from exact logs. Fix root causes, not symptoms.
- Test both success and failure paths, including duplicate requests, stale sessions, permission denial, network loss, retry exhaustion, conflicting updates, and partial failures where relevant.
- Capture command, environment, result, and commit SHA. Never claim a check ran when it did not.

Deliverable: verification report and updated bug/risk register.

### 6. Review and parity
- Compare acceptance criteria with the actual implementation.
- Compare original and current UI only when legitimate reference material is available and use it for behavior/layout understanding, not asset/copy reuse.
- Score each feature as `not-started`, `partial`, `verified`, or `blocked`; include evidence and owner/next action.
- Critical financial, security, data-integrity, and offline flows require explicit review.

Deliverable: `replica/parity.md` and a prioritized gap list.

### 7. Release and operations
- Release preflight: CI green, migration plan reviewed, backups/restore understood, environment variables verified, observability/alerts ready, support/recovery runbook ready.
- User approval is required before production migrations, live payment activation, or deployment.
- Monitor errors, sync backlog, payment reconciliation, print failures, and tenant/branch isolation after release.

Deliverable: release checklist and post-release watch plan.

## How the original Replica skills map

| Original skill | Use in this project |
|---|---|
| replica-recon | Existing-system, screen, flow, and feature audit |
| replica-architect | Impact analysis, data/API design, ADRs |
| replica-design | UI states, tokens, components, accessibility |
| replica-build | Dependency-ordered implementation |
| replica-backend | API, persistence, auth, integrations |
| replica-test | Unit/integration/E2E and failure-path testing |
| replica-diff | Acceptance and UI/behavior parity |
| replica-entrepreneur | Optional user-feedback research; never fabricate evidence |
| replica-brand | Not part of routine internal POS engineering; use only for a separately approved rebrand |
| replica-launch | Product release/pricing/listing planning only when requested |
| replica-deploy | Controlled deployment preflight; user approval remains mandatory |

## Required reporting format

Every work batch reports:
- **Scope:** what changed and why.
- **Evidence inspected:** branch/commit, files, PRs, logs, docs.
- **Changes:** files and behavior changed.
- **Validation:** exact commands and outcomes; skipped checks.
- **Risks / unresolved:** what remains uncertain or blocked.
- **Next step:** one dependency-ordered action.
