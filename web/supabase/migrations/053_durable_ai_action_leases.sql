-- A crashed request must become explicitly uncertain instead of leaving a
-- mutation permanently running and eligible for an unsafe replay.
ALTER TABLE public.ai_action_operations
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS fencing_token bigint NOT NULL DEFAULT 0;

UPDATE public.ai_action_operations
SET lease_expires_at = coalesce(lease_expires_at, now() + interval '5 minutes'),
    heartbeat_at = coalesce(heartbeat_at, now())
WHERE status = 'running';

CREATE INDEX IF NOT EXISTS ai_action_operations_running_lease_idx
  ON public.ai_action_operations (lease_expires_at)
  WHERE status = 'running';

CREATE OR REPLACE FUNCTION public.claim_ai_action_operation(
  p_shop_id uuid,
  p_user_id uuid,
  p_action text,
  p_idempotency_key text,
  p_payload_hash text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_row public.ai_action_operations%rowtype;
  v_now timestamptz := now();
  v_lease interval := interval '5 minutes';
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Internal operation coordinator only' USING errcode = '42501';
  END IF;
  IF p_shop_id IS NULL OR p_user_id IS NULL OR nullif(btrim(p_action), '') IS NULL
     OR nullif(btrim(p_idempotency_key), '') IS NULL OR nullif(btrim(p_payload_hash), '') IS NULL THEN
    RAISE EXCEPTION 'Operation identity is incomplete' USING errcode = '22023';
  END IF;
  IF length(p_idempotency_key) > 160 OR length(p_action) > 100 THEN
    RAISE EXCEPTION 'Operation identity is too long' USING errcode = '22023';
  END IF;

  INSERT INTO public.ai_action_operations
    (shop_id, user_id, action, idempotency_key, payload_hash, status,
     lease_expires_at, heartbeat_at, fencing_token)
  VALUES
    (p_shop_id, p_user_id, p_action, p_idempotency_key, p_payload_hash, 'running',
     v_now + v_lease, v_now, 1)
  ON CONFLICT (shop_id, action, idempotency_key) DO NOTHING
  RETURNING * INTO v_row;

  IF v_row.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'claimed', true, 'status', v_row.status, 'id', v_row.id,
      'result', v_row.result, 'error', v_row.error,
      'payload_hash', v_row.payload_hash,
      'audit_status', v_row.audit_status, 'audit_error', v_row.audit_error,
      'audit_target_type', v_row.audit_target_type,
      'audit_target_id', v_row.audit_target_id,
      'audit_permission', v_row.audit_permission,
      'audit_approved', v_row.audit_approved,
      'audit_metadata', v_row.audit_metadata,
      'lease_expires_at', v_row.lease_expires_at,
      'heartbeat_at', v_row.heartbeat_at,
      'fencing_token', v_row.fencing_token
    );
  END IF;

  SELECT * INTO v_row
  FROM public.ai_action_operations
  WHERE shop_id = p_shop_id
    AND action = p_action
    AND idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF v_row.payload_hash <> p_payload_hash THEN
    RETURN jsonb_build_object(
      'claimed', false, 'status', 'conflict', 'id', v_row.id,
      'error', 'Idempotency key was used for a different payload'
    );
  END IF;

  IF v_row.status = 'running'
     AND coalesce(v_row.lease_expires_at, v_now) <= v_now THEN
    UPDATE public.ai_action_operations
    SET status = 'unknown',
        error = 'AI action lease expired; outcome requires reconciliation',
        lease_expires_at = NULL,
        heartbeat_at = v_now,
        updated_at = v_now
    WHERE id = v_row.id
    RETURNING * INTO v_row;
  END IF;

  RETURN jsonb_build_object(
    'claimed', false, 'status', v_row.status, 'id', v_row.id,
    'result', v_row.result, 'error', v_row.error,
    'payload_hash', v_row.payload_hash,
    'audit_status', v_row.audit_status, 'audit_error', v_row.audit_error,
    'audit_target_type', v_row.audit_target_type,
    'audit_target_id', v_row.audit_target_id,
    'audit_permission', v_row.audit_permission,
    'audit_approved', v_row.audit_approved,
    'audit_metadata', v_row.audit_metadata,
    'lease_expires_at', v_row.lease_expires_at,
    'heartbeat_at', v_row.heartbeat_at,
    'fencing_token', v_row.fencing_token
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_ai_action_operation(uuid, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_ai_action_operation(uuid, uuid, text, text, text) TO service_role;
