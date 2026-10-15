-- Make outbound message logging replay-safe. Provider idempotency prevents a
-- second delivery; this key prevents the local message timeline from gaining
-- duplicate rows when the first response was lost after delivery.
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS messages_shop_idempotency_key_uq
  ON public.messages (shop_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
