-- Fencing tokens must be unique across windows, not just increments within
-- one (shop, automation, window) row. A stale worker from an older window
-- must never share a token with a newer worker.
CREATE SEQUENCE IF NOT EXISTS public.automation_fencing_token_seq AS bigint;

DO $$
DECLARE
  v_max bigint;
BEGIN
  SELECT max(fencing_token) INTO v_max FROM public.automation_runs;
  IF coalesce(v_max, 0) > 0 THEN
    PERFORM setval('public.automation_fencing_token_seq', v_max, true);
  ELSE
    PERFORM setval('public.automation_fencing_token_seq', 1, false);
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.claim_automation_run_v2(
  p_shop_id uuid,
  p_automation_id text,
  p_window_key text,
  p_lease_seconds integer DEFAULT 300
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_row public.automation_runs%rowtype;
  v_now timestamptz := now();
  v_lease integer := greatest(30, least(coalesce(p_lease_seconds, 300), 3600));
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Internal worker only' USING errcode = '42501';
  END IF;
  IF p_shop_id IS NULL
     OR nullif(btrim(p_automation_id), '') IS NULL
     OR nullif(btrim(p_window_key), '') IS NULL THEN
    RAISE EXCEPTION 'Automation identity is incomplete' USING errcode = '22023';
  END IF;

  INSERT INTO public.automation_runs (
    shop_id, automation_id, window_key, status, attempts, started_at,
    lease_expires_at, heartbeat_at, fencing_token
  ) VALUES (
    p_shop_id, p_automation_id, p_window_key, 'running', 1, v_now,
    v_now + make_interval(secs => v_lease), v_now,
    nextval('public.automation_fencing_token_seq')
  )
  ON CONFLICT (shop_id, automation_id, window_key) DO UPDATE
    SET status = 'running',
        attempts = public.automation_runs.attempts + 1,
        started_at = v_now,
        finished_at = NULL,
        next_attempt_at = NULL,
        error = NULL,
        result = NULL,
        fencing_token = nextval('public.automation_fencing_token_seq'),
        lease_expires_at = v_now + make_interval(secs => v_lease),
        heartbeat_at = v_now
    WHERE (
      public.automation_runs.status IN ('failed', 'retry_wait')
      AND coalesce(public.automation_runs.next_attempt_at, v_now) <= v_now
    ) OR (
      public.automation_runs.status = 'running'
      AND coalesce(public.automation_runs.lease_expires_at, v_now) <= v_now
    )
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    SELECT * INTO v_row
    FROM public.automation_runs
    WHERE shop_id = p_shop_id
      AND automation_id = p_automation_id
      AND window_key = p_window_key;
    RETURN jsonb_build_object(
      'claimed', false, 'id', v_row.id, 'status', v_row.status,
      'fencing_token', v_row.fencing_token
    );
  END IF;

  UPDATE public.automations
     SET active_fencing_token = v_row.fencing_token,
         updated_at = v_now
   WHERE shop_id = p_shop_id
     AND id::text = p_automation_id;

  RETURN jsonb_build_object(
    'claimed', true, 'id', v_row.id, 'status', v_row.status,
    'fencing_token', v_row.fencing_token,
    'lease_expires_at', v_row.lease_expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_automation_run_v2(uuid, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_automation_run_v2(uuid, text, text, integer) TO service_role;
