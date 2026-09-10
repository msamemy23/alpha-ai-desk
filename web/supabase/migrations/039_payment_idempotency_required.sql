-- Require an idempotency key for every new payment write.
-- NOT VALID preserves legacy payment rows while enforcing the invariant for
-- all new inserts and updates, including calls through older RPC overloads.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'payments'
      AND c.conname = 'payments_idempotency_key_required'
  ) THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_idempotency_key_required
      CHECK (idempotency_key IS NOT NULL AND btrim(idempotency_key) <> '')
      NOT VALID;
  END IF;
END
$$;

-- Give legacy rows stable metadata before validating the constraint. This does
-- not alter payment amounts, balances, or document relationships. The legacy
-- ledger guards validate related records on every UPDATE, so the column-only
-- backfill temporarily disables only those two guards inside this transaction.
ALTER TABLE public.payments DISABLE TRIGGER payments_ledger_guard;
ALTER TABLE public.payments DISABLE TRIGGER payments_same_shop_guard;
UPDATE public.payments
SET idempotency_key = 'legacy-payment-' || id::text
WHERE nullif(btrim(idempotency_key), '') IS NULL;
ALTER TABLE public.payments ENABLE TRIGGER payments_ledger_guard;
ALTER TABLE public.payments ENABLE TRIGGER payments_same_shop_guard;

ALTER TABLE public.payments
  VALIDATE CONSTRAINT payments_idempotency_key_required;
