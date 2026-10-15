-- Keep signature writes server-owned and remove demoted-owner profile access.
ALTER TABLE IF EXISTS public.signatures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_insert ON public.signatures;
DROP POLICY IF EXISTS tenant_update ON public.signatures;
DROP POLICY IF EXISTS tenant_delete ON public.signatures;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.signatures FROM anon, authenticated;
GRANT SELECT ON TABLE public.signatures TO authenticated;
DROP POLICY IF EXISTS signatures_service_role_only ON public.signatures;
CREATE POLICY signatures_service_role_only
  ON public.signatures
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
DROP POLICY IF EXISTS shop_profiles_update_access ON public.shop_profiles;
CREATE POLICY shop_profiles_update_access
  ON public.shop_profiles
  FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT auth.uid()) AND private.user_can_write_shop(id))
  WITH CHECK (user_id = (SELECT auth.uid()) AND private.user_can_write_shop(id));
DROP POLICY IF EXISTS shop_profiles_delete_access ON public.shop_profiles;
REVOKE DELETE ON TABLE public.shop_profiles FROM anon, authenticated;
