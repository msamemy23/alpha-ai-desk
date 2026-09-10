-- Remove the legacy own-row policies that bypass membership revocation.
DROP POLICY IF EXISTS shop_profiles_select_own ON public.shop_profiles;
DROP POLICY IF EXISTS shop_profiles_update_own ON public.shop_profiles;
DROP POLICY IF EXISTS "Users can view own shop profile" ON public.shop_profiles;
DROP POLICY IF EXISTS "Users can update own shop profile" ON public.shop_profiles;

DROP POLICY IF EXISTS shop_profiles_select_access ON public.shop_profiles;
CREATE POLICY shop_profiles_select_access
  ON public.shop_profiles
  FOR SELECT TO authenticated
  USING ((SELECT private.user_has_shop_access(id)));

DROP POLICY IF EXISTS shop_profiles_update_access ON public.shop_profiles;
CREATE POLICY shop_profiles_update_access
  ON public.shop_profiles
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id AND (SELECT private.user_has_shop_access(id)))
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS shop_profiles_delete_access ON public.shop_profiles;
CREATE POLICY shop_profiles_delete_access
  ON public.shop_profiles
  FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id AND (SELECT private.user_has_shop_access(id)));
