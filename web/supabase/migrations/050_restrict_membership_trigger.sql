-- The function is used only by the shop_profiles INSERT trigger. It must not
-- be exposed as an anonymous or authenticated PostgREST RPC.
REVOKE ALL ON FUNCTION public.bootstrap_shop_membership() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bootstrap_shop_membership() FROM anon;
REVOKE ALL ON FUNCTION public.bootstrap_shop_membership() FROM authenticated;
