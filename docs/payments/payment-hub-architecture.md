# Payment Hub — Architecture and Implementation Plan

## Scope

Add a provider-neutral payment orchestration layer to Restaurant POS OS. The first release must support both:
1. Direct transfers to a restaurant-owned receiving account (InstaPay or wallet), where an incoming transaction is reconciled only from a trusted bank/provider statement, API, or verified integration.
2. Per-order payment requests (hosted checkout, payment link, or QR) confirmed by an authenticated provider webhook or a provider-side status lookup.

This document describes the target architecture and the verified current-code gaps. It does not activate a payment provider, change production data, or claim that InstaPay exposes a public merchant API.

## Existing implementation (reviewed on feat/hr-accounting-inventory)

- `Payment` already stores `orderId`, `shiftId`, decimal amount, free-form method, reference, received/change amounts, `PaymentStatus`, and a unique idempotency key.
- `PaymentStatus` currently contains only `PENDING`, `PAID`, `PARTIALLY_REFUNDED`, `REFUNDED`, and `VOIDED`.
- `PaymentAdjustment` records refund/void operations with actor, device, reason, reference, and idempotency identifiers.
- The NestJS `PaymentModule` currently provides `PaymentController`, `PaymentService`, and `RefundService`.
- `POST /payments/settle` accepts only `CASH`, `CARD`, `WALLET`, and `OTHER` allocations.
- The current settlement path creates every submitted allocation as `PAID` immediately, closes the order, posts accounting, consumes inventory, and records the cash drawer movement in one serializable transaction. This is appropriate only for payment methods whose receipt is already verified at the POS; it must not be reused as the asynchronous gateway/webhook path.
- Existing payment settlement requires an open shift and device-bound session. Preserve those controls for cashier-originated actions.

## Core design rules

### 1. Payment lifecycle is separate from order lifecycle

A payment intent has its own state. A provider callback must never set an order's fulfillment state directly. A verified payment may emit a domain event that the existing order workflow handles according to order type and configured policy.

Suggested intent states:
- `CREATED`: intent persisted locally.
- `PENDING`: awaiting payer/provider.
- `PROCESSING`: provider reports processing.
- `SUCCEEDED`: verified successful receipt.
- `FAILED`: definitive provider failure.
- `EXPIRED`: request expired.
- `CANCELLED`: cancelled before success.
- `REVIEW_REQUIRED`: ambiguous or unmatched direct transfer.
- `REFUND_PENDING` / `REFUNDED`: refund lifecycle.

Do not expand or repurpose the existing `PaymentStatus` until the intent-vs-settled-payment distinction and migration are implemented. The existing `Payment` row should represent a booked/settled financial receipt, while a new intent/attempt represents a pending external transaction.

### 2. Provider adapter boundary

Define a provider-neutral contract for:
- creating a payment request;
- verifying webhook authenticity;
- normalizing provider events;
- looking up a provider transaction when webhook delivery is delayed;
- requesting refunds where supported;
- reporting supported payment methods/currencies.

Provider-specific SDKs, secrets, payload shapes, and API quirks must remain inside adapters. Provider credentials belong in server-side secret storage, never desktop/mobile clients or database plaintext.

### 3. Webhook security and idempotency

- Verify signature/authentication against the raw request body using the provider's documented algorithm and secret rotation strategy.
- Enforce timestamp/replay window where supported.
- Persist each provider event with a unique provider + event identifier before applying side effects.
- Make event handling idempotent; duplicate delivery must not create another payment, accounting journal, inventory consumption, or order event.
- Match provider merchant account, tenant/branch, intent, currency, and exact amount before success.
- Never trust client-submitted success flags, screenshots, SMS text, or redirect query parameters as payment confirmation.
- If provider data is inconsistent or cannot be verified, transition to `REVIEW_REQUIRED` and do not book revenue.

### 4. Direct-transfer reconciliation

Direct transfers require a trusted source of incoming transactions (official bank/provider API, verified statement feed, or approved integration). A customer-entered reference or screenshot is only a matching hint.

Reconciliation must match receiving account, currency, exact amount, provider/bank transaction reference, and a safe time window. Ambiguous, duplicate, underpaid, overpaid, or unmatched transfers go to a human review queue. A mobile notification/SMS reader is not an authoritative financial source and must not auto-settle payments.

### 5. Financial posting

Only a single successful transition from a verified intent may create a settled `Payment` and invoke the existing accounting posting path. The transition and creation of the financial receipt/outbox event must be atomic. Inventory consumption and order fulfillment must follow existing business-cycle rules, not be duplicated in a webhook handler.

Refunds remain separate adjustment operations; provider refunds must reconcile provider status before local adjustment is marked complete.

## Target persistence model (new migration required)

Proposed entities (names are provisional and must be reconciled with the complete schema before migration):

- `PaymentProviderAccount`: tenant/branch scope, provider key, display name, enabled methods, receiving-account metadata, status. Store only non-secret identifiers/configuration; secrets in a dedicated secret store.
- `PaymentIntent`: order, branch, amount, currency, method, provider/account, state, expiry, idempotency key, created-by, and settled payment link.
- `PaymentAttempt`: intent, provider transaction ID, checkout URL/QR reference, attempt number, request/response metadata with sensitive values redacted.
- `PaymentProviderEvent`: provider, event ID, received time, signature verification result, payload hash, processing status, and safe redacted payload; unique(provider,eventId).
- `PaymentReconciliationItem`: imported bank/provider transaction reference, account, amount, timestamp, matching state, matched intent/payment, and reviewer audit fields.

All tenant-owned records must carry tenant and branch scope as appropriate and be covered by the repository's existing RLS transaction context and deny-by-default policies. Add unique constraints for provider event identity, provider transaction identity, and intent idempotency within the correct tenant/provider scope.

## API shape (target)

Authenticated POS/customer routes:
- `POST /payment-intents`: create an intent for an eligible order; server calculates amount from the order, never trusts client amount.
- `GET /payment-intents/:id`: return scoped intent status.
- `POST /payment-intents/:id/cancel`: cancel only if provider and lifecycle allow it.

Provider routes:
- `POST /payment-providers/:provider/webhook`: raw-body signature verification, event persistence, asynchronous idempotent processing. Provider callbacks must not require a cashier session, but must be constrained by provider credentials and account mapping.

Reconciliation routes (permission-gated):
- import trusted transaction feed, list unmatched items, manually match/reject with reason, and review audit history.

## Order and payment behavior

- Pending asynchronous payment does not close the order, post revenue, consume inventory, or mark the order paid.
- Verified success is recorded once. Whether preparation can begin before payment is a tenant-configurable policy; default for online prepaid orders is wait for verified payment.
- Dine-in, takeaway, and delivery remain order types, not payment statuses.
- Cash/card terminal payments already verified at the POS may continue through the existing synchronous settlement flow.
- Partial payments/split tender must not be confused with an incomplete provider intent. Define explicit remaining-balance rules before enabling partial external payments.

## Delivery phases

1. **Foundation and schema review:** provider-neutral domain types, state transition policy, threat model, schema/RLS migration plan, tests. No live provider.
2. **Payment intents:** create/query/cancel intent with server-calculated totals, expiry, order/shift/branch permissions, and idempotency.
3. **First gateway adapter:** select a licensed/contracted provider after reviewing Egypt merchant onboarding, settlement, wallet coverage, fees, refunds, webhook docs, and support. Implement sandbox only first.
4. **Webhook processing:** raw-body verification, event inbox, replay protection, reconciliation lookup, and atomic settlement.
5. **Direct-transfer reconciliation:** only after a trusted transaction feed is confirmed; add review queue and matching rules.
6. **POS and finance UI:** cashier payment status, pending queue, reconciliation workspace, branch reports, settlement/refund views.
7. **Operational hardening:** failure injection, duplicate/out-of-order webhook tests, audit review, provider outage handling, monitoring, and runbooks.

## Acceptance criteria

- Duplicate webhook events and duplicate provider transaction IDs cannot double-book.
- Invalid signatures, stale/replayed events, wrong amount/currency/account, unknown intents, and cross-tenant events never settle.
- A pending/failed/expired/review-required intent never creates a settled `Payment` or revenue journal.
- A valid verified success settles exactly once and emits exactly one payment event.
- Order type is unchanged by payment confirmation; order workflow transition is explicit and policy-driven.
- All new tenant data is protected by RLS and branch/tenant authorization tests.
- Secrets and sensitive provider payload fields are never exposed to desktop clients or logs.
- Existing cash settlement, refunds, accounting, inventory, offline sync, and cash drawer tests continue to pass.

## Explicit non-goals for this foundation

- No scraping or reading personal banking apps/SMS as authoritative proof.
- No assumption that InstaPay has an open merchant API.
- No production credentials, real-money transactions, or production migrations.
- No hard dependency on a single gateway vendor.
