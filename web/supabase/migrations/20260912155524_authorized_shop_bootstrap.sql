-- RLS must not authorize a hard-revoked owner. Bootstrap through a narrowly
-- scoped RPC instead of weakening SELECT policies for INSERT ... RETURNING.
CREATE OR REPLACE FUNCTION public.ensure_shop_profile(p_shop_name text DEFAULT 'My Shop')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_shop_id uuid;
  v_created boolean := false;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Sign in before creating a shop' USING ERRCODE = '42501';
  END IF;

  -- Serialize concurrent callbacks for this user without blocking other users.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));
  SELECT sm.shop_id INTO v_shop_id
  FROM public.shop_memberships sm
  WHERE sm.user_id = v_user_id AND sm.status = 'active'
  ORDER BY sm.created_at, sm.shop_id LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('id', v_shop_id, 'created', false);
  END IF;

  -- Never restore a revoked membership or create a replacement shop for it.
  IF EXISTS (SELECT 1 FROM public.shop_profiles WHERE user_id = v_user_id)
     OR EXISTS (SELECT 1 FROM public.shop_memberships WHERE user_id = v_user_id) THEN
    RAISE EXCEPTION 'Your shop access is inactive. Contact the shop owner.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.shop_profiles(user_id, shop_name)
  VALUES (v_user_id, left(coalesce(nullif(trim(p_shop_name), ''), 'My Shop'), 120))
  RETURNING id INTO v_shop_id;
  v_created := true;
  IF NOT EXISTS (SELECT 1 FROM public.shop_memberships
                 WHERE shop_id = v_shop_id AND user_id = v_user_id
                   AND role = 'owner' AND status = 'active') THEN
    RAISE EXCEPTION 'Shop membership could not be created';
  END IF;
  RETURN jsonb_build_object('id', v_shop_id, 'created', v_created);
END;
$function$;

REVOKE ALL ON FUNCTION public.ensure_shop_profile(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_shop_profile(text) TO authenticated;
