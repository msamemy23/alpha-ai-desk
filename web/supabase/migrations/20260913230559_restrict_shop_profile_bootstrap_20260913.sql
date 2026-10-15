-- Shop creation is performed by the authenticated server endpoint. Keeping an
-- INSERT policy here would let a revoked user insert a new profile and have
-- the legacy membership trigger silently promote it to owner.
drop policy if exists shop_profiles_insert_own on public.shop_profiles;
drop policy if exists "Users can insert shop profile" on public.shop_profiles;
revoke insert on table public.shop_profiles from anon, authenticated;
