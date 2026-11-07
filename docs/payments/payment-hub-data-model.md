# Payment Hub — Data Model and RLS Decision Record

## Repository facts verified before designing the migration

The current Prisma schema is tenant/branch-aware, but the existing financial tables are not uniformly shaped:

- `Order` owns `Payment[]`; its branch is resolved through `Order.branchId -> Branch.tenantId`.
- `Payment` requires both `orderId` and `shiftId`. It stores money as `Decimal(12,2)`, a free-form method, optional reference, `PaymentStatus`, and a globally unique idempotency key.
- `PaymentAdjustment` also requires order and shift and has globally unique idempotency/operation identifiers.
- `Tenant` and `Branch` are the authoritative business scope. Branch has a tenantId and is unique by tenant + code.
- Existing RLS policies for `Payment` and `PaymentAdjustment` derive tenant/branch visibility through Order -> Branch. The request context is transaction-local and currently contains tenant, branch, user, and session IDs.
- The existing migration history has duplicate `0025` names. The next payment migration must use a new unique name and must not assume migration numbers are perfectly sequential.

## Decisions for the new asynchronous payment domain

### PaymentIntent

A pending external payment is not a booked `Payment`. Keep the existing Payment model as the financial receipt created only after verified success.

Required fields:
- opaque local id;
- tenantId + branchId + orderId;
- amount as `Decimal(12,2)` and ISO currency code;
- method/provider key and optional provider-account id;
- explicit intent status and expiry;
- tenant-scoped idempotency key;
- optional settledPaymentId, unique when present;
- createdBy user id and timestamps.

The amount is computed by the API from the order and remaining balance. A client must not supply an authoritative amount. The order must be re-read and checked inside the same transaction that creates the intent.

### PaymentProviderAccount

One tenant may configure multiple provider accounts, and a tenant may use one account centrally or restrict it to a branch. Store non-secret provider identifiers and receiving-account display metadata only. Provider credentials and signing secrets stay in server-side secret storage.

A provider account must be explicitly enabled and mapped to exactly one tenant, with optional branch scope. A provider event may not select its tenant from untrusted payload fields.

### PaymentAttempt

One intent may have multiple attempts (for example, checkout link regeneration). Keep provider transaction IDs unique within the provider-account scope. Persist safe request/response metadata only; redact tokens, PAN/card data, signing secrets, and personal data not needed for reconciliation.

### PaymentProviderEvent

Use an inbox record for webhook deduplication and audit:
- provider account;
- provider event id;
- received timestamp;
- signature verification result;
- payload hash;
- processing state and safe redacted payload;
- processed timestamp/error code.

Enforce uniqueness on providerAccountId + providerEventId. Do not persist unredacted raw payload by default. Store the provider transaction identifier under a separate unique constraint where the provider contract guarantees its uniqueness.

### PaymentReconciliationItem

Represent trusted bank/provider feed rows independently of customer claims:
- provider account;
- external transaction id unique per account;
- amount/currency/transaction time;
- payer/reference hints;
- matching state;
- optional matched intent/payment;
- reviewer, reason, and review timestamps.

Screenshots, SMS, user-entered references, and redirect parameters are not trusted feed rows.

## RLS requirements and a blocker to solve before enabling webhook writes

Normal authenticated API calls can use the existing transaction-local tenant/branch/user/session context. New tenant-owned intent, provider-account, and reconciliation rows must have explicit RLS policies using that context.

Provider webhooks are different: they have no cashier/user session. Do not weaken RLS or allow a public webhook route to set arbitrary tenant IDs. Before enabling RLS on webhook inbox/attempt writes, implement a narrowly scoped provider-account bootstrap context:
1. Resolve an opaque, high-entropy webhook endpoint key to one active provider account using a dedicated bootstrap path.
2. Verify the provider signature using the server-side secret associated with that account and the exact raw request body.
3. Set transaction-local provider-account scope only after the account lookup; never accept tenantId/branchId from the event body.
4. RLS policies for webhook writes must require that provider-account scope and derive tenant/branch from the mapped account.
5. Persist the event idempotently, then process it in a separate scoped transaction.

This bootstrap path needs integration tests for unknown/disabled account keys, invalid signatures, cross-tenant payloads, duplicate event IDs, and connection-pool context reset.

## Migration safety checklist

- Add Prisma relations on Tenant, Branch, Order, and the new payment models without changing existing Payment or Order semantics.
- Add SQL foreign keys and indexes matching the Prisma schema; consider composite tenant/branch consistency constraints where the current schema supports them.
- Add RLS policies before enabling/forcing RLS on new tables. Do not enable FORCE RLS until all legitimate access paths, including provider webhook bootstrap and background workers, have tested scoped contexts.
- Keep all idempotency constraints scoped to the correct tenant/provider account; avoid accidental global uniqueness unless the identifier is truly globally unique by provider contract.
- Add migration validation against a real PostgreSQL service in CI, plus Prisma schema validation and generated-client typecheck.
- No production migration or live provider credentials in this phase.

## Implemented foundation in PR #10

The branch also adds the webhook inbox foundation in `0030_payment_provider_webhook_inbox`:

- `PaymentProviderAccount.webhookKeyHash` stores only a SHA-256 digest of a high-entropy endpoint key; the plaintext key is generated once and must be shown only at creation/rotation time.
- `PaymentProviderEvent` stores provider-account-scoped event IDs, SHA-256 payload hashes, signature-verification outcome, processing state, and timestamps. Raw payloads and provider secrets are not stored.
- A unique constraint on `providerAccountId + providerEventId` makes duplicate delivery idempotently detectable.
- Two transaction-local RLS contexts are available: endpoint-hash bootstrap (one active provider-account lookup) and resolved provider-account scope (event inbox access for that account only).
- PostgreSQL integration coverage checks endpoint-hash lookup isolation, provider-account-scoped inbox reads, and duplicate event rejection.

The branch now adds the first database foundation in `0029_payment_hub_intents`:

- `PaymentProviderAccount`: tenant-owned receiving/provider account metadata, optional branch restriction, masked account reference, and a secret-manager reference. No provider secret is stored in this table.
- `PaymentIntent`: order- and branch-scoped intent with exact integer minor-unit amount, ISO-style three-letter currency, explicit status/channel, tenant-scoped merchant reference and idempotency key, optional checkout URL, and expiry/success timestamps.
- `PaymentAttempt`: appendable attempt history with per-intent attempt sequence and tenant-scoped provider transaction uniqueness.
- Composite foreign keys bind provider account to the same tenant, intent to the same tenant + branch + order, and attempt to the same tenant + intent. These constraints prevent accidental cross-tenant or cross-branch linking even if an application caller supplies mismatched IDs.
- The three new tables receive explicit tenant/branch RLS policies and ENABLE + FORCE RLS in the same migration.

The existing `Payment` model is intentionally unchanged. A successful external intent is not yet a booked payment and does not close an order, post accounting, consume inventory, or create a cash-drawer movement.

## Not implemented yet

This foundation does not yet expose an HTTP webhook route, verify any provider-specific signature, fetch provider secrets, process inbox events into payment intents, perform trusted bank-feed imports, reconcile transactions, create the final booked `Payment`, or integrate a live provider. The database inbox and RLS contexts are groundwork only: the eventual controller must hash the opaque endpoint key, resolve exactly one active account, verify the provider signature over the exact raw request bytes, then enter the resolved provider-account context before inserting an event. It must never use tenant/branch values from the provider payload. No production migration or live provider credentials are included in this phase.
