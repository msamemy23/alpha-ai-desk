-- Membership status is authoritative. Keep the profile-owner fallback only
-- for legacy shops that have no membership row at all.
CREATE OR REPLACE FUNCTION private.user_has_shop_access(p_shop_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.shop_memberships sm
    WHERE sm.shop_id = p_shop_id
      AND sm.user_id = (SELECT auth.uid())
      AND sm.status = 'active'
  )
  OR (
    NOT EXISTS (
      SELECT 1
      FROM public.shop_memberships sm
      WHERE sm.shop_id = p_shop_id
        AND sm.user_id = (SELECT auth.uid())
    )
    AND EXISTS (
      SELECT 1
      FROM public.shop_profiles sp
      WHERE sp.id = p_shop_id
        AND sp.user_id = (SELECT auth.uid())
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.user_has_shop_access(p_shop_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.shop_memberships sm
    WHERE sm.shop_id = p_shop_id
      AND sm.user_id = auth.uid()
      AND sm.status = 'active'
  )
  OR (
    NOT EXISTS (
      SELECT 1
      FROM public.shop_memberships sm
      WHERE sm.shop_id = p_shop_id
        AND sm.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1
      FROM public.shop_profiles sp
      WHERE sp.id = p_shop_id
        AND sp.user_id = auth.uid()
    )
  );
$$;
