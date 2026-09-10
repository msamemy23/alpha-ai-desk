-- Return whether the durable operation was newly claimed. This prevents a
-- second request from re-running a mutation while the first is still running.
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
declare
  v_row public.ai_action_operations%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Internal operation coordinator only' using errcode = '42501';
  end if;
  if p_shop_id is null or p_user_id is null or nullif(btrim(p_action), '') is null
     or nullif(btrim(p_idempotency_key), '') is null or nullif(btrim(p_payload_hash), '') is null then
    raise exception 'Operation identity is incomplete' using errcode = '22023';
  end if;
  if length(p_idempotency_key) > 160 or length(p_action) > 100 then
    raise exception 'Operation identity is too long' using errcode = '22023';
  end if;

  INSERT INTO public.ai_action_operations
    (shop_id, user_id, action, idempotency_key, payload_hash, status)
  VALUES
    (p_shop_id, p_user_id, p_action, p_idempotency_key, p_payload_hash, 'running')
  ON CONFLICT (shop_id, action, idempotency_key) DO NOTHING
  RETURNING * INTO v_row;

  IF v_row.id IS NOT NULL THEN
    RETURN jsonb_build_object('claimed', true, 'status', v_row.status,
      'id', v_row.id, 'result', v_row.result, 'error', v_row.error,
      'payload_hash', v_row.payload_hash);
  END IF;

  SELECT * INTO v_row
  FROM public.ai_action_operations
  WHERE shop_id = p_shop_id AND action = p_action
    AND idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF v_row.payload_hash <> p_payload_hash THEN
    RETURN jsonb_build_object('claimed', false, 'status', 'conflict',
      'id', v_row.id, 'error', 'Idempotency key was used for a different payload');
  END IF;

  RETURN jsonb_build_object('claimed', false, 'status', v_row.status,
    'id', v_row.id, 'result', v_row.result, 'error', v_row.error,
    'payload_hash', v_row.payload_hash);
end;
$function$;
