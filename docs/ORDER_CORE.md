# Order Core — Initial Contract

## Purpose

All order channels use the same domain model and explicit state machine. V1 activates POS and CALL_CENTER; MOBILE, WEB, QR and AGGREGATOR are reserved for future clients.

## Sources

- POS
- CALL_CENTER
- MOBILE (future)
- WEB (future)
- QR (future)
- AGGREGATOR (future)

## Order types

- DINE_IN
- TAKEAWAY
- DELIVERY

## States

```text
DRAFT
  -> CONFIRMED
  -> SENT_TO_KITCHEN
  -> PREPARING
  -> READY
  -> ASSIGNED
  -> OUT_FOR_DELIVERY
  -> DELIVERED
  -> CLOSED
```

Exceptional terminal states:
- CANCELLED
- VOIDED
- REFUNDED
- FAILED

Not every order type uses every state. Delivery-specific states apply only to delivery orders.

## Protected operations

After `SENT_TO_KITCHEN`, issued items are not silently edited or deleted. Changes become explicit events/commands and require the appropriate permission and reason.

Examples:

- `ADD_ITEM`
- `VOID_ITEM`
- `CHANGE_MODIFIER`
- `CANCEL_ORDER`
- `REFUND_PAYMENT`
- `REASSIGN_DRIVER`

## Idempotency

Order creation, payment creation, refunds, state-transition commands and synchronization retries must accept an idempotency key. Repeating the same command must not create duplicate business effects.

## Event model

Important order events include:

- ORDER_CREATED
- ORDER_CONFIRMED
- ORDER_SENT_TO_KITCHEN
- ITEM_ADDED
- ITEM_VOIDED
- ORDER_PREPARING
- ORDER_READY
- DRIVER_ASSIGNED
- ORDER_OUT_FOR_DELIVERY
- ORDER_DELIVERED
- ORDER_CLOSED
- ORDER_CANCELLED
- PAYMENT_CAPTURED
- PAYMENT_REFUNDED

Every event records actor, branch, device, timestamp and correlation identifiers.
