-- Membership status must gate the legacy shop profile policies as well as
-- the tenant tables that reference the profile.
DROP POLICY IF EXISTS "Users can view own shop profile" ON public.shop_profiles;
DROP POLICY IF EXISTS shop_profiles_select_membership ON public.shop_profiles;
CREATE POLICY shop_profiles_select_access
  ON public.shop_profiles
  FOR SELECT TO authenticated
  USING (private.user_has_shop_access(id));

DROP POLICY IF EXISTS "Users can update own shop profile" ON public.shop_profiles;
CREATE POLICY shop_profiles_update_access
  ON public.shop_profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND private.user_has_shop_access(id))
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own shop profile" ON public.shop_profiles;
CREATE POLICY shop_profiles_delete_access
  ON public.shop_profiles
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND private.user_has_shop_access(id));

-- A crashed SMS worker must become explicitly uncertain instead of remaining
-- in_progress forever. An uncertain provider call is never automatically
-- retried, because Telnyx may already have accepted it.
ALTER TABLE public.message_send_operations
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz NULL;

UPDATE public.message_send_operations
SET lease_expires_at = coalesce(lease_expires_at, now() + interval '5 minutes'),
    heartbeat_at = coalesce(heartbeat_at, now())
WHERE status = 'sending';

CREATE INDEX IF NOT EXISTS message_send_operations_sending_lease_idx
  ON public.message_send_operations (lease_expires_at)
  WHERE status = 'sending';

CREATE OR REPLACE FUNCTION public.claim_sms_send_operation(
  p_shop_id uuid,
  p_channel text,
  p_operation_key text,
  p_payload_hash text,
  p_to_number text,
  p_customer_id uuid,
  p_body text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_operation public.message_send_operations%rowtype;
  v_now timestamptz := now();
  v_lease interval := interval '5 minutes';
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Internal worker only' USING errcode = '42501';
  END IF;
  IF p_channel <> 'sms' OR nullif(btrim(coalesce(p_operation_key, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A valid SMS operation is required' USING errcode = '22023';
  END IF;
  IF length(coalesce(p_payload_hash, '')) <> 64 THEN
    RAISE EXCEPTION 'A valid SMS payload hash is required' USING errcode = '22023';
  END IF;

  INSERT INTO public.message_send_operations (
    shop_id, channel, operation_key, payload_hash, to_number, customer_id,
    body, status, attempts, lease_expires_at, heartbeat_at
  ) VALUES (
    p_shop_id, p_channel, p_operation_key, p_payload_hash, p_to_number,
    p_customer_id, p_body, 'sending', 1, v_now + v_lease, v_now
  )
  ON CONFLICT (shop_id, channel, operation_key) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'claimed', 'operation_id', v_id, 'attempts', 1);
  END IF;

  SELECT * INTO v_operation
    FROM public.message_send_operations
   WHERE shop_id = p_shop_id AND channel = p_channel AND operation_key = p_operation_key
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SMS operation could not be claimed' USING errcode = '40001';
  END IF;
  IF v_operation.payload_hash <> p_payload_hash
     OR v_operation.to_number <> p_to_number
     OR v_operation.customer_id IS DISTINCT FROM p_customer_id
     OR v_operation.body <> p_body THEN
    RAISE EXCEPTION 'SMS operation key was reused for a different payload' USING errcode = '23505';
  END IF;

  IF v_operation.status = 'sending'
     AND coalesce(v_operation.lease_expires_at, v_now) <= v_now THEN
    UPDATE public.message_send_operations
       SET status = 'unknown',
           last_error = 'SMS worker lease expired; provider outcome requires reconciliation',
           lease_expires_at = NULL,
           heartbeat_at = v_now,
           updated_at = v_now
     WHERE id = v_operation.id
     RETURNING * INTO v_operation;
  END IF;

  IF v_operation.status = 'sent' THEN
    RETURN jsonb_build_object('status', 'sent', 'operation_id', v_operation.id, 'provider_message_id', v_operation.provider_message_id);
  END IF;
  IF v_operation.status = 'sending' THEN
    RETURN jsonb_build_object('status', 'in_progress', 'operation_id', v_operation.id);
  END IF;
  IF v_operation.status = 'unknown' THEN
    RETURN jsonb_build_object('status', 'unknown', 'operation_id', v_operation.id, 'last_error', v_operation.last_error);
  END IF;
  IF v_operation.attempts >= 3 THEN
    RETURN jsonb_build_object('status', 'failed', 'operation_id', v_operation.id, 'last_error', v_operation.last_error);
  END IF;

  UPDATE public.message_send_operations
     SET status = 'sending',
         attempts = attempts + 1,
         last_error = NULL,
         lease_expires_at = v_now + v_lease,
         heartbeat_at = v_now,
         updated_at = v_now
   WHERE id = v_operation.id;
  RETURN jsonb_build_object('status', 'claimed', 'operation_id', v_operation.id, 'attempts', v_operation.attempts + 1);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_sms_send_operation(uuid, text, text, text, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_sms_send_operation(uuid, text, text, text, text, uuid, text) TO service_role;
