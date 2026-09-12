-- Chat history is a replacement operation, so timestamps alone are not a
-- stable message order. Store an explicit sequence and revision per session.
ALTER TABLE public.ai_chat_history
  ADD COLUMN IF NOT EXISTS sequence_no bigint,
  ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 1;

WITH ordered AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY shop_id, user_id, session_id
      ORDER BY created_at ASC, id ASC
    )::bigint AS sequence_no
  FROM public.ai_chat_history
)
UPDATE public.ai_chat_history h
SET sequence_no = ordered.sequence_no
FROM ordered
WHERE h.id = ordered.id
  AND h.sequence_no IS NULL;

ALTER TABLE public.ai_chat_history
  ALTER COLUMN sequence_no SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ai_chat_history_session_sequence_idx
  ON public.ai_chat_history (shop_id, user_id, session_id, sequence_no);

CREATE INDEX IF NOT EXISTS ai_chat_history_session_revision_idx
  ON public.ai_chat_history (shop_id, user_id, session_id, revision, sequence_no);

CREATE OR REPLACE FUNCTION public.replace_ai_chat_history(
  p_shop_id uuid,
  p_user_id uuid,
  p_session_id text,
  p_messages jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_revision bigint;
  v_messages jsonb := CASE
    WHEN jsonb_typeof(coalesce(p_messages, '[]'::jsonb)) = 'array'
      THEN coalesce(p_messages, '[]'::jsonb)
    ELSE '[]'::jsonb
  END;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Internal worker only' USING errcode = '42501';
  END IF;
  IF p_shop_id IS NULL OR p_user_id IS NULL OR nullif(btrim(p_session_id), '') IS NULL THEN
    RAISE EXCEPTION 'Chat history identity is incomplete' USING errcode = '22023';
  END IF;

  -- Serialize replacements for the same session so two saves cannot produce
  -- duplicate sequence numbers or silently interleave revisions.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(concat_ws(':', p_shop_id::text, p_user_id::text, p_session_id), 0)
  );

  SELECT coalesce(max(revision), 0) + 1
    INTO v_revision
  FROM public.ai_chat_history
  WHERE shop_id = p_shop_id
    AND user_id = p_user_id
    AND session_id = p_session_id;

  DELETE FROM public.ai_chat_history
   WHERE shop_id = p_shop_id
     AND user_id = p_user_id
     AND session_id = p_session_id;

  INSERT INTO public.ai_chat_history
    (shop_id, user_id, session_id, role, content, sequence_no, revision, created_at)
  SELECT
    p_shop_id,
    p_user_id,
    p_session_id,
    CASE WHEN message->>'role' IN ('user', 'browser') THEN message->>'role' ELSE 'assistant' END,
    message::text,
    entry.ordinality::bigint,
    v_revision,
    now() + ((entry.ordinality - 1) * interval '1 microsecond')
  FROM jsonb_array_elements(v_messages) WITH ORDINALITY AS entry(message, ordinality);
END;
$function$;

REVOKE ALL ON FUNCTION public.replace_ai_chat_history(uuid, uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.replace_ai_chat_history(uuid, uuid, text, jsonb) TO service_role;
