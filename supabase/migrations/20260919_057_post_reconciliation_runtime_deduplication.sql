-- ==============================================================================
-- BO'SH STORE — POST-RECONCILIATION RUNTIME DEDUPLICATION
-- Migration: 20260919_057_post_reconciliation_runtime_deduplication
-- Purpose:
--   1. Remove the redundant payment idempotency index after source reconciliation.
--   2. Remove the narrower duplicate payment shift trigger; the original
--      concurrency trigger already fires on INSERT/UPDATE and invokes the same
--      authoritative function.
-- ==============================================================================

DROP INDEX IF EXISTS public.idx_payments_idempotency_key_unique;

DROP TRIGGER IF EXISTS trg_payment_lock_pos_shift ON public.payments;
