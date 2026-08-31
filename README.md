# Restaurant POS OS

Professional multi-branch restaurant POS and central operations platform.

## Current scope

Desktop-first restaurant operations:

- Branch POS
- Central Call Center
- Kitchen operations
- Delivery dispatch
- Payments and cashier shifts
- Inventory foundation
- Offline-first operation and synchronization
- Thermal printing
- RBAC and audit trail
- Arabic / English with RTL / LTR

## Future-ready channels

The core is designed to support customer web, mobile, QR ordering and delivery aggregators later without redesigning the Order Core.

## Architecture principles

- Offline-first at branch level
- Explicit order state transitions
- Server-side authorization
- Idempotent commands
- Auditable sensitive actions
- Local print queue
- Compact, station-aware printing
- Arabic and English as first-class UI languages

## Documentation

- `docs/RESTAURANT_POS_MASTER_BLUEPRINT.md` — product and architecture baseline
