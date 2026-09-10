-- Membership-only users need to read the shop profile used to initialize the
-- app. Keep writes owner-scoped; this is a read policy only.
ALTER TABLE public.shop_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shop_profiles_select_membership ON public.shop_profiles;
CREATE POLICY shop_profiles_select_membership
  ON public.shop_profiles
  FOR SELECT TO authenticated
  USING (private.user_has_shop_access(id));
