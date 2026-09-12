-- Perform automation child writes while holding the current run lease lock.
-- A worker whose lease has been reclaimed cannot append a business record or
-- mark an appointment reminder after another worker has taken over.

CREATE OR REPLACE FUNCTION public.insert_social_post_fenced(
  p_shop_id uuid,
  p_run_id uuid,
  p_fencing_token bigint,
  p_text text,
  p_platforms text[],
  p_media_urls text[] DEFAULT '{}',
  p_media_paths text[] DEFAULT '{}',
  p_status text DEFAULT 'draft'
)
RETURNS public.social_posts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_run public.automation_runs%rowtype;
  v_post public.social_posts%rowtype;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Internal worker only' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_run
    FROM public.automation_runs
   WHERE id = p_run_id
     AND shop_id = p_shop_id
     AND fencing_token = p_fencing_token
     AND status = 'running'
     AND lease_expires_at IS NOT NULL
     AND lease_expires_at > now()
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Automation run lease is stale or no longer active' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.social_posts
    (shop_id, text, platforms, media_urls, media_paths, status, created_at)
  VALUES
    (p_shop_id, p_text, coalesce(p_platforms, '{}'::text[]),
     coalesce(p_media_urls, '{}'::text[]), coalesce(p_media_paths, '{}'::text[]),
     coalesce(nullif(p_status, ''), 'draft'), now())
  RETURNING * INTO v_post;

  RETURN v_post;
END;
$function$;

CREATE OR REPLACE FUNCTION public.insert_service_reminder_fenced(
  p_shop_id uuid,
  p_run_id uuid,
  p_fencing_token bigint,
  p_vehicle_id uuid,
  p_customer_id uuid,
  p_message text,
  p_sent boolean
)
RETURNS public.service_reminders_sent
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_run public.automation_runs%rowtype;
  v_reminder public.service_reminders_sent%rowtype;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Internal worker only' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_run
    FROM public.automation_runs
   WHERE id = p_run_id
     AND shop_id = p_shop_id
     AND fencing_token = p_fencing_token
     AND status = 'running'
     AND lease_expires_at IS NOT NULL
     AND lease_expires_at > now()
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Automation run lease is stale or no longer active' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.service_reminders_sent
    (shop_id, vehicle_id, customer_id, message, sent, created_at)
  VALUES
    (p_shop_id, p_vehicle_id, p_customer_id, p_message, coalesce(p_sent, false), now())
  RETURNING * INTO v_reminder;

  RETURN v_reminder;
END;
$function$;

CREATE OR REPLACE FUNCTION public.insert_estimate_followup_fenced(
  p_shop_id uuid,
  p_run_id uuid,
  p_fencing_token bigint,
  p_estimate_id uuid,
  p_customer_id uuid,
  p_method text,
  p_sent boolean
)
RETURNS public.estimate_followups_sent
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_run public.automation_runs%rowtype;
  v_followup public.estimate_followups_sent%rowtype;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Internal worker only' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_run
    FROM public.automation_runs
   WHERE id = p_run_id
     AND shop_id = p_shop_id
     AND fencing_token = p_fencing_token
     AND status = 'running'
     AND lease_expires_at IS NOT NULL
     AND lease_expires_at > now()
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Automation run lease is stale or no longer active' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.estimate_followups_sent
    (shop_id, estimate_id, customer_id, method, sent, created_at)
  VALUES
    (p_shop_id, p_estimate_id, p_customer_id, p_method, coalesce(p_sent, false), now())
  RETURNING * INTO v_followup;

  RETURN v_followup;
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_appointment_reminder_fenced(
  p_shop_id uuid,
  p_run_id uuid,
  p_fencing_token bigint,
  p_appointment_id uuid,
  p_reminder_sent_at timestamptz DEFAULT now()
)
RETURNS public.appointments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_run public.automation_runs%rowtype;
  v_appointment public.appointments%rowtype;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Internal worker only' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_run
    FROM public.automation_runs
   WHERE id = p_run_id
     AND shop_id = p_shop_id
     AND fencing_token = p_fencing_token
     AND status = 'running'
     AND lease_expires_at IS NOT NULL
     AND lease_expires_at > now()
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Automation run lease is stale or no longer active' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.appointments
     SET reminder_sent_at = coalesce(p_reminder_sent_at, now()),
         updated_at = now()
   WHERE id = p_appointment_id
     AND shop_id = p_shop_id
     AND reminder_sent_at IS NULL
  RETURNING * INTO v_appointment;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Appointment reminder was already recorded or appointment is missing' USING ERRCODE = 'P0001';
  END IF;

  RETURN v_appointment;
END;
$function$;

REVOKE ALL ON FUNCTION public.insert_social_post_fenced(uuid, uuid, bigint, text, text[], text[], text[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_social_post_fenced(uuid, uuid, bigint, text, text[], text[], text[], text) TO service_role;
REVOKE ALL ON FUNCTION public.insert_service_reminder_fenced(uuid, uuid, bigint, uuid, uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_service_reminder_fenced(uuid, uuid, bigint, uuid, uuid, text, boolean) TO service_role;
REVOKE ALL ON FUNCTION public.insert_estimate_followup_fenced(uuid, uuid, bigint, uuid, uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_estimate_followup_fenced(uuid, uuid, bigint, uuid, uuid, text, boolean) TO service_role;
REVOKE ALL ON FUNCTION public.mark_appointment_reminder_fenced(uuid, uuid, bigint, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_appointment_reminder_fenced(uuid, uuid, bigint, uuid, timestamptz) TO service_role;
