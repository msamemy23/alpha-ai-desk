-- Provider APIs do not all offer an idempotency header. Persist the publish
-- attempt before the network call so a retry after a timeout cannot silently
-- post the same content a second time.
CREATE TABLE IF NOT EXISTS public.social_publishing_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shop_profiles(id) ON DELETE CASCADE,
  user_id uuid NULL,
  platform text NOT NULL,
  action text NOT NULL,
  idempotency_key text NOT NULL,
  payload_hash text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  result jsonb NULL,
  error text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NULL,
  CONSTRAINT social_publishing_operations_status_check
    CHECK (status IN ('running', 'succeeded', 'failed', 'unknown'))
);

CREATE UNIQUE INDEX IF NOT EXISTS social_publishing_operations_identity_idx
  ON public.social_publishing_operations (shop_id, platform, action, idempotency_key);

CREATE INDEX IF NOT EXISTS social_publishing_operations_shop_created_idx
  ON public.social_publishing_operations (shop_id, created_at DESC);

ALTER TABLE public.social_publishing_operations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS social_publishing_operations_service_role_only ON public.social_publishing_operations;
CREATE POLICY social_publishing_operations_service_role_only
  ON public.social_publishing_operations
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
