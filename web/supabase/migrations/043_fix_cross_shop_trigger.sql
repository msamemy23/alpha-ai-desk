-- EXECUTE ... INTO does not update PL/pgSQL FOUND. Check the returned shop
-- directly so valid references are not rejected after a dynamic lookup.
CREATE OR REPLACE FUNCTION public.prevent_cross_shop_reference()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_new jsonb := to_jsonb(NEW);
  v_shop_id uuid;
  v_related_shop uuid;
  v_related_id uuid;
  v_ref record;
BEGIN
  IF nullif(v_new->>'shop_id', '') IS NULL THEN
    RETURN NEW;
  END IF;
  v_shop_id := (v_new->>'shop_id')::uuid;

  FOR v_ref IN
    SELECT * FROM (VALUES
      ('customer_id', 'customers'),
      ('job_id', 'jobs'),
      ('document_id', 'documents')
    ) AS refs(column_name, table_name)
    WHERE v_new ? refs.column_name
      AND nullif(v_new->>refs.column_name, '') IS NOT NULL
      AND (
        (TG_TABLE_NAME IN ('documents','jobs','vehicles','appointments','scheduled_messages','payments','messages') AND refs.column_name = 'customer_id') OR
        (TG_TABLE_NAME = 'documents' AND refs.column_name = 'job_id') OR
        (TG_TABLE_NAME IN ('payments','messages') AND refs.column_name = 'document_id')
      )
  LOOP
    IF to_regclass('public.' || v_ref.table_name) IS NULL THEN
      CONTINUE;
    END IF;
    v_related_id := (v_new->>v_ref.column_name)::uuid;
    v_related_shop := NULL;
    EXECUTE format('SELECT shop_id FROM public.%I WHERE id = $1', v_ref.table_name)
      INTO v_related_shop USING v_related_id;
    IF v_related_shop IS NULL OR v_related_shop IS DISTINCT FROM v_shop_id THEN
      RAISE EXCEPTION '% cannot reference a record from another shop', v_ref.column_name USING errcode = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
