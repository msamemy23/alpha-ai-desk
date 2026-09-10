begin;

-- These legacy tables are no longer part of the application contract. Keep
-- them unavailable to browser roles even if a future migration accidentally
-- changes an RLS policy; service_role remains the only administrative path.
revoke all on table public.audit_log from public, anon, authenticated;
revoke all on table public.campaigns from public, anon, authenticated;
revoke all on table public.telnyx_sync_log from public, anon, authenticated;

commit;
