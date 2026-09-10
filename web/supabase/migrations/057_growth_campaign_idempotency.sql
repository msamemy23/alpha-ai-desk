-- A provider-side ad may already exist when the local campaign write is
-- interrupted. Persist the request key so replay repairs the local row
-- without creating a second campaign record.
ALTER TABLE public.growth_campaigns
  ADD COLUMN IF NOT EXISTS idempotency_key text NULL;

CREATE UNIQUE INDEX IF NOT EXISTS growth_campaigns_shop_idempotency_idx
  ON public.growth_campaigns (shop_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND btrim(idempotency_key) <> '';
