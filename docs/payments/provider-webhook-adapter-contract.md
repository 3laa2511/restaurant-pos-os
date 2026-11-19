# Provider webhook adapter contract

This layer defines the provider-neutral boundary only. It does not expose an HTTP
route, verify a real provider signature, process an inbox row, advance a payment
intent, or settle a payment.

## Contract

- The HTTP integration must preserve the exact raw request bytes and pass them
  to `ProviderWebhookAdapter.verifyAndNormalize`.
- Provider-specific adapters verify signatures and replay windows using the
  provider's published specification. Re-serialized JSON is not a valid
  substitute for the raw request bytes.
- Provider credentials are supplied by a caller that retrieves them from a
  secret manager. Do not persist provider secrets in the database or logs.
- Only a `verified: true` result can enter the normalized-event pipeline.
- Normalized money uses positive `bigint` minor units; floating-point amounts
  are prohibited.
- Nullable transaction/correlation fields are permitted so ambiguous events
  can be placed into review rather than falsely matched.
- The contract intentionally does not claim that InstaPay offers a public
  merchant webhook API. A concrete adapter requires a documented, trusted
  provider interface and its exact signature/replay rules.

## Not authorized by this contract

A verified webhook event is not, by itself, permission to close an order, post
accounting, consume inventory, or move cash-drawer balances. Those actions remain
a separate idempotent booking workflow after intent correlation and policy
validation.
