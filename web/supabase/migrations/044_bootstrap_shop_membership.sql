-- Every newly created shop gets an owner membership in the same database
-- transaction, so signup cannot leave a profile that RLS cannot use.
CREATE OR REPLACE FUNCTION public.bootstrap_shop_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
BEGIN
  INSERT INTO public.shop_memberships (shop_id, user_id, role, status)
  VALUES (NEW.id, NEW.user_id, 'owner', 'active')
  ON CONFLICT (shop_id, user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.bootstrap_shop_membership() FROM PUBLIC;

DROP TRIGGER IF EXISTS shop_profiles_bootstrap_membership ON public.shop_profiles;
CREATE TRIGGER shop_profiles_bootstrap_membership
AFTER INSERT ON public.shop_profiles
FOR EACH ROW EXECUTE FUNCTION public.bootstrap_shop_membership();

INSERT INTO public.shop_memberships (shop_id, user_id, role, status)
SELECT s.id, s.user_id, 'owner', 'active'
FROM public.shop_profiles s
LEFT JOIN public.shop_memberships m
  ON m.shop_id = s.id AND m.user_id = s.user_id
WHERE m.shop_id IS NULL;
