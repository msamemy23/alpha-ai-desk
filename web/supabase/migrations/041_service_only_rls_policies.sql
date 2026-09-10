-- Keep service-only operational tables explicit under RLS.
-- The policy is limited to service_role; ordinary users remain denied.
DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'ai_action_operations',
    'automation_runs',
    'message_send_operations',
    'sms_consents'
  ] LOOP
    BEGIN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
        v_table || '_service_role_only',
        v_table
      );
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END LOOP;
END
$$;
