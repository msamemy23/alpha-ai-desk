-- Membership-only users need to read the shop profile used to initialize the
-- app. Keep writes owner-scoped; this is a read policy only.
--
-- The access helper is defined here rather than assumed, because this policy
-- depends on it. Migration 051 redefines the same function later; both use
-- CREATE OR REPLACE with an identical body, so replaying the full migration
-- set on a fresh database succeeds in either order.
-- `authenticated` needs USAGE on this schema to evaluate the policy below;
-- revoking it would make every shop_profiles read fail. Only anon and PUBLIC
-- are shut out. This mirrors the live ACL exactly.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.user_has_shop_access(p_shop_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.shop_memberships sm
    WHERE sm.shop_id = p_shop_id
      AND sm.user_id = (SELECT auth.uid())
      AND sm.status = 'active'
  )
  OR (
    NOT EXISTS (
      SELECT 1 FROM public.shop_memberships sm
      WHERE sm.shop_id = p_shop_id
        AND sm.user_id = (SELECT auth.uid())
    )
    AND EXISTS (
      SELECT 1 FROM public.shop_profiles sp
      WHERE sp.id = p_shop_id
        AND sp.user_id = (SELECT auth.uid())
    )
  );
$function$;

REVOKE ALL ON FUNCTION private.user_has_shop_access(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.user_has_shop_access(uuid) TO authenticated, service_role;

ALTER TABLE public.shop_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shop_profiles_select_membership ON public.shop_profiles;
CREATE POLICY shop_profiles_select_membership
  ON public.shop_profiles
  FOR SELECT TO authenticated
  USING (private.user_has_shop_access(id));
