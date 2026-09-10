-- Complete the payment idempotency migration for legacy rows without
-- changing their financial values or document relationships. The backfill is
-- metadata-only, so the two legacy validation triggers are disabled only for
-- this transaction and restored before validation completes.
ALTER TABLE public.payments DISABLE TRIGGER payments_ledger_guard;
ALTER TABLE public.payments DISABLE TRIGGER payments_same_shop_guard;
UPDATE public.payments
SET idempotency_key = 'legacy-payment-' || id::text
WHERE nullif(btrim(idempotency_key), '') IS NULL;
ALTER TABLE public.payments ENABLE TRIGGER payments_ledger_guard;
ALTER TABLE public.payments ENABLE TRIGGER payments_same_shop_guard;

ALTER TABLE public.payments
  VALIDATE CONSTRAINT payments_idempotency_key_required;
