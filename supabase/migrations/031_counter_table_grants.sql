begin;

-- Supabase projects may grant newly-created public tables to anon by default.
-- The counter is accessed only through the authenticated numbering RPC and
-- must not be directly readable or writable by browser roles.
revoke all on table public.document_number_counters from public, anon, authenticated, service_role;
grant select, insert, update on table public.document_number_counters to authenticated, service_role;

commit;
