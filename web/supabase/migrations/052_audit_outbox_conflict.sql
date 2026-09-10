-- PostgREST upsert needs a unique/exclusion constraint that exactly matches
-- its onConflict target. The original partial index excluded NULL keys and
-- therefore could not be inferred by an upsert on (shop_id,idempotency_key).
DROP INDEX IF EXISTS public.audit_log_outbox_idempotency_idx;
CREATE UNIQUE INDEX audit_log_outbox_idempotency_idx
  ON public.audit_log_outbox (shop_id, idempotency_key);
