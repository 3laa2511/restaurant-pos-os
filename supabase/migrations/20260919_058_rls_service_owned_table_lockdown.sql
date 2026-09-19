-- 20260919_058_rls_service_owned_table_lockdown
-- RLS is enabled for service-authoritative/internal tables that must not be
-- directly reachable by anon/authenticated Data API roles.
ALTER TABLE public.accountability_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_assignment_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_cancellation_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_cod_collection_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_delivery_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_receipt_reprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_refund_settlement_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_refund_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.risk_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;

-- Deliberately no anon/authenticated policies. Server-side API uses service_role
-- and therefore remains authoritative without exposing financial/operational
-- tables through the client Data API.
