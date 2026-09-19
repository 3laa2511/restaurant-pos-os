# Staging Migration Reconciliation — 2026-09-19

## Scope

This branch records the reconciliation work between the authoritative Staging Supabase database and the GitHub source tree for `3laa2511/restaurant-pos-os`.

## Findings

- Staging migration ledger reaches logical migration `20260919_055_pos_checkout_payment_shift_expression_fix`.
- GitHub `main` does not currently contain the corresponding 013–055 Supabase migration source chain.
- Four migration names were applied more than once in Staging, but their stored SQL is byte-for-byte identical within each duplicate group:
  - `20260902_015_gaming_branch_ownership`
  - `20260902_016_rls_hardening`
  - `20260903_013_cash_drawer_shift_management`
  - `20260904_019_phase_4_7_final_hardening`
- These duplicate ledger applications are therefore not evidence of divergent SQL. They must not be deleted or rewritten without reconciling the migration source and database catalog.
- Payment lock behavior has two trigger names:
  - `trg_lock_pos_shift_for_payment`, introduced by `20260905_029_concurrency_integrity`, fires `BEFORE INSERT OR UPDATE`.
  - `trg_payment_lock_pos_shift`, introduced later by the 2026-09-19 POS payment authority correction chain, fires `BEFORE INSERT OR UPDATE OF shift_id`.
- The later trigger uses the same authoritative function `fn_lock_pos_shift_for_payment()`. The function now validates payment-side branch/cashier/shift binding.
- The later migration `20260919_055_pos_checkout_payment_shift_expression_fix` repeats the trigger replacement from `20260919_054_pos_payment_order_context_alignment` while also fixing the checkout shift expression. This is historical migration content and should be preserved during source recovery; cleanup should be a separate, reviewed migration.
- Payment idempotency has two unique partial indexes with identical definitions but different names:
  - `idx_payments_idempotency_key_unique` from `20260905_026_payment_settlement_integrity`
  - `uq_payments_idempotency_key` from `20260906_031_pos_idempotency_authority`
- Payments also have two equivalent positive-amount CHECK constraints with different names:
  - `payments_amount_check`
  - `payments_amount_positive`
  The latter is explicitly recreated by `20260903_012_atomic_checkout_payment_hardening`.

## Safety rule

No duplicate trigger, index, constraint, or migration-ledger row is removed in this reconciliation branch until the canonical source chain and actual catalog definitions have been compared.

## Next steps

1. Recover the missing Staging migration SQL into versioned repository files.
2. Verify the recovered chain against the Staging migration ledger.
3. Compare the recovered SQL with the live PostgreSQL catalog.
4. Add a dedicated cleanup migration only for confirmed redundant runtime objects.
5. Add reproducible Supabase migration checks to CI.
6. Only after schema/source reconciliation, proceed to fixtures and real DB workflow execution.
