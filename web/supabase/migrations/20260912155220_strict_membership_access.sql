-- Memberships are the only authorization source. Migration 044 backfilled
-- existing owners; its AFTER INSERT trigger creates each new shop's owner.
-- The following authorized_shop_bootstrap migration supplies the guarded
-- signup RPC needed because upsert evaluates SELECT RLS before AFTER triggers.
CREATE OR REPLACE FUNCTION private.user_has_shop_access(p_shop_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.shop_memberships sm
    WHERE sm.shop_id = p_shop_id
      AND sm.user_id = (SELECT auth.uid())
      AND sm.status = 'active'
  );
$function$;

CREATE OR REPLACE FUNCTION public.user_has_shop_access(p_shop_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.shop_memberships sm
    WHERE sm.shop_id = p_shop_id
      AND sm.user_id = (SELECT auth.uid())
      AND sm.status = 'active'
  );
$function$;

-- CREATE OR REPLACE preserves the existing restrictive function grants.
