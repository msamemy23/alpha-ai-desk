-- Recovery code records uncertain provider/database outcomes explicitly.
ALTER TABLE public.ai_action_operations
  DROP CONSTRAINT IF EXISTS ai_action_operations_status_check;
ALTER TABLE public.ai_action_operations
  ADD CONSTRAINT ai_action_operations_status_check
  CHECK (status IN ('running', 'succeeded', 'failed', 'unknown'));

-- A provider message id is the durable identity of one outbound SMS. The
-- nullable column still permits legacy/inbound rows without a provider id.
CREATE UNIQUE INDEX IF NOT EXISTS messages_shop_telnyx_message_id_idx
  ON public.messages (shop_id, telnyx_message_id);

ALTER TABLE public.growth_campaigns
  ADD COLUMN IF NOT EXISTS idempotency_payload_hash text NULL;
