-- An audit write must survive a transient database failure. The outbox is
-- service-only and is retried by the operation replay path before a durable
-- AI result is returned again.
CREATE TABLE IF NOT EXISTS public.audit_log_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shop_profiles(id) ON DELETE CASCADE,
  user_id uuid NULL,
  action text NOT NULL,
  target_type text NULL,
  target_id text NULL,
  permission text NULL,
  approved boolean NOT NULL DEFAULT false,
  idempotency_key text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts integer NOT NULL DEFAULT 0,
  last_error text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS audit_log_outbox_idempotency_idx
  ON public.audit_log_outbox (shop_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS audit_log_outbox_pending_idx
  ON public.audit_log_outbox (shop_id, created_at)
  WHERE delivered_at IS NULL;

ALTER TABLE public.audit_log_outbox ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_log_outbox_service_role_only ON public.audit_log_outbox;
CREATE POLICY audit_log_outbox_service_role_only
  ON public.audit_log_outbox
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE UNIQUE INDEX IF NOT EXISTS audit_logs_shop_idempotency_unique_idx
  ON public.audit_logs (shop_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.ai_action_operations
  ADD COLUMN IF NOT EXISTS audit_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS audit_error text NULL,
  ADD COLUMN IF NOT EXISTS audit_target_type text NULL,
  ADD COLUMN IF NOT EXISTS audit_target_id text NULL,
  ADD COLUMN IF NOT EXISTS audit_permission text NULL,
  ADD COLUMN IF NOT EXISTS audit_approved boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS audit_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.ai_action_operations
  DROP CONSTRAINT IF EXISTS ai_action_operations_audit_status_check;
ALTER TABLE public.ai_action_operations
  ADD CONSTRAINT ai_action_operations_audit_status_check
  CHECK (audit_status IN ('pending', 'queued', 'delivered'));

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
    (shop_id, user_id, action, idempotency_key, payload_hash, status)
  VALUES
    (p_shop_id, p_user_id, p_action, p_idempotency_key, p_payload_hash, 'running')
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
      'audit_metadata', v_row.audit_metadata
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

  RETURN jsonb_build_object(
    'claimed', false, 'status', v_row.status, 'id', v_row.id,
    'result', v_row.result, 'error', v_row.error,
    'payload_hash', v_row.payload_hash,
    'audit_status', v_row.audit_status, 'audit_error', v_row.audit_error,
    'audit_target_type', v_row.audit_target_type,
    'audit_target_id', v_row.audit_target_id,
    'audit_permission', v_row.audit_permission,
    'audit_approved', v_row.audit_approved,
    'audit_metadata', v_row.audit_metadata
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_ai_action_operation(uuid, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_ai_action_operation(uuid, uuid, text, text, text) TO service_role;
