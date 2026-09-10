-- Browser tool messages are a first-class part of the AI conversation history.
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c
  FROM pg_constraint
  WHERE conrelid = 'public.ai_chat_history'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%role%';
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.ai_chat_history DROP CONSTRAINT %I', c);
  END IF;
END $$;

ALTER TABLE public.ai_chat_history
  ADD CONSTRAINT ai_chat_history_role_check
  CHECK (role = ANY (ARRAY['user','assistant','system','tool','browser']));
