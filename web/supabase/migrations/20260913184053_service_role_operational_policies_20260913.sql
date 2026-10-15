DO $$
BEGIN
  IF to_regclass('public.ai_workflow_sessions') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS ai_workflow_sessions_service_role_only ON public.ai_workflow_sessions';
    EXECUTE 'CREATE POLICY ai_workflow_sessions_service_role_only ON public.ai_workflow_sessions FOR ALL TO service_role USING (true) WITH CHECK (true)';
  END IF;
  IF to_regclass('public.private_chatgpt_connections') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS private_chatgpt_connections_service_role_only ON public.private_chatgpt_connections';
    EXECUTE 'CREATE POLICY private_chatgpt_connections_service_role_only ON public.private_chatgpt_connections FOR ALL TO service_role USING (true) WITH CHECK (true)';
  END IF;
END
$$;
