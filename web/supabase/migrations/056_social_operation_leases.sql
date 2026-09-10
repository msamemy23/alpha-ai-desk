-- Provider operations must not remain running forever after a crashed
-- worker. An expired provider operation is uncertain and is never replayed
-- automatically.
ALTER TABLE public.social_publishing_operations
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz NULL;

UPDATE public.social_publishing_operations
SET lease_expires_at = coalesce(lease_expires_at, now() + interval '5 minutes'),
    heartbeat_at = coalesce(heartbeat_at, now())
WHERE status = 'running';

CREATE INDEX IF NOT EXISTS social_publishing_operations_running_lease_idx
  ON public.social_publishing_operations (lease_expires_at)
  WHERE status = 'running';
