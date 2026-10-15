ALTER TABLE public.signatures
  ADD COLUMN IF NOT EXISTS document_hash text,
  ADD COLUMN IF NOT EXISTS document_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS document_snapshot jsonb;

CREATE INDEX IF NOT EXISTS signatures_document_id_idx
  ON public.signatures (shop_id, document_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.complete_signature(
  p_token uuid,
  p_shop_id uuid,
  p_document_id uuid,
  p_signer_name text,
  p_signature_data text,
  p_ip_address text,
  p_document_hash text,
  p_document_snapshot jsonb,
  p_expected_updated_at timestamptz,
  p_signed_at timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_signature public.signatures%rowtype;
  v_document public.documents%rowtype;
  v_rows integer;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Internal signature coordinator only' USING errcode = '42501';
  END IF;
  IF p_token IS NULL OR p_shop_id IS NULL OR p_document_id IS NULL
     OR nullif(btrim(p_signer_name), '') IS NULL
     OR nullif(btrim(p_document_hash), '') IS NULL
     OR p_document_snapshot IS NULL THEN
    RAISE EXCEPTION 'Signature completion data is incomplete' USING errcode = '22023';
  END IF;

  SELECT * INTO v_signature
    FROM public.signatures
   WHERE token = p_token
     AND shop_id = p_shop_id
     AND document_id = p_document_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;
  IF v_signature.signed_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'already_signed', 'signed_at', v_signature.signed_at, 'signer_name', v_signature.signer_name);
  END IF;
  IF v_signature.expires_at IS NOT NULL AND v_signature.expires_at <= now() THEN
    RETURN jsonb_build_object('status', 'expired');
  END IF;

  SELECT * INTO v_document
    FROM public.documents
   WHERE id = p_document_id
     AND shop_id = p_shop_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  IF (v_signature.document_hash IS NOT NULL AND v_signature.document_hash IS DISTINCT FROM p_document_hash)
     OR (v_signature.document_updated_at IS NOT NULL AND v_signature.document_updated_at IS DISTINCT FROM v_document.updated_at)
     OR (v_signature.document_updated_at IS NULL AND v_signature.document_hash IS NULL
         AND v_signature.created_at IS NOT NULL AND v_document.updated_at > v_signature.created_at)
     OR (p_expected_updated_at IS DISTINCT FROM v_document.updated_at) THEN
    RETURN jsonb_build_object('status', 'stale');
  END IF;

  UPDATE public.signatures
     SET signed_at = p_signed_at,
         signer_name = btrim(p_signer_name),
         signature_data = p_signature_data,
         ip_address = nullif(btrim(p_ip_address), ''),
         document_hash = p_document_hash,
         document_updated_at = v_document.updated_at,
         document_snapshot = p_document_snapshot
   WHERE id = v_signature.id
     AND signed_at IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Signature row could not be completed';
  END IF;

  UPDATE public.documents
     SET signature_signed_at = p_signed_at,
         signature_signer_name = btrim(p_signer_name)
   WHERE id = v_document.id
     AND shop_id = p_shop_id
     AND updated_at = v_document.updated_at;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Document row could not be completed';
  END IF;

  RETURN jsonb_build_object('status', 'signed', 'signed_at', p_signed_at);
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_signature(uuid, uuid, uuid, text, text, text, text, jsonb, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_signature(uuid, uuid, uuid, text, text, text, text, jsonb, timestamptz, timestamptz) TO service_role;
