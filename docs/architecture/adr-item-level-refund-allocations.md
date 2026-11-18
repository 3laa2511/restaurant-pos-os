# ADR: Item-level refunds and return allocations

- **Status:** Proposed — implementation intentionally deferred
- **Date:** 2026-11-18
- **Scope:** Restaurant POS OS payments and order items

## Current limitation

The current refund model records a payment-level adjustment (`PaymentAdjustment.amount`) and a cash drawer outflow. `OrderItem` stores quantity, unit price, line total, and modifier snapshots, but it does not store an immutable allocation of order-level discounts, fees, or taxes. The current order record stores only its final total. A payment may also be split across more than one payment row.

Therefore, selecting an item and multiplying its current product price by quantity would be financially unsafe: the product's current price may differ from the historical sale, and the order's discount/tax/fee treatment cannot be reconstructed reliably from the current persisted order snapshot.

## Required data model before implementation

1. Add an immutable `PaymentAdjustmentItem` allocation table linked to one `PaymentAdjustment` and one `OrderItem`, with quantity returned, gross line amount snapshot, allocated discount amount, allocated tax/fee amount, final refundable amount, and original unit-price/modifier snapshots where needed.
2. Enforce same-order ownership for the adjustment and item using composite foreign keys or transaction-level ownership checks plus database constraints where supported.
3. Track previously returned quantity per order item across all adjustments. Reject returns exceeding the sold quantity, including concurrent requests.
4. Calculate the refund from immutable sale-time values using integer minor units; never query the current product price to calculate a historical refund.
5. Define deterministic allocation of discounts, tax and fees across items, including rounding residual handling. The sum of item allocations must reconcile exactly to the refundable order/payment amount.
6. For split tenders, allocate item refund value to one or more original payments without exceeding each payment's remaining refundable balance. Cash drawer outflow is created only for cash allocations; card/wallet allocations remain disabled until provider adapters support real reversals.
7. Keep the operation idempotent and transactional across adjustment rows, returned quantities, payment status, drawer movements, accounting journal, order events, and audit records.
8. Add manager approval policy for configurable refund thresholds and high-risk item returns. Approval identity and reason must be persisted and auditable.

## Migration and rollout

- Add a new forward-only migration after `0033_dining_tables`; do not edit or renumber historical migrations.
- Backfill is not possible with confidence for historical orders that lack immutable discount/tax/fee allocations. Those orders must remain eligible only for payment-level refunds until the data-retention policy and backfill rules are explicitly approved.
- Ship behind a feature flag and enable only for orders created after the new sale snapshot is live.
- Required tests: concurrent partial quantity return, duplicate idempotency key, split-tender allocation, rounding residual, full order refund status, partial payment refund, accounting failure rollback, and cross-branch rejection.

## Decision

Keep the current cash payment-level refund flow as the safe limited feature. Do not expose item-level refund controls until the immutable sale snapshot and allocation model above are implemented and reconciled.
