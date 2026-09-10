-- Keep shop profile access tenant-scoped. Anonymous clients must never read or mutate it.
revoke all on table public.shop_profiles from anon, public;
grant select, insert, update, delete on table public.shop_profiles to authenticated;