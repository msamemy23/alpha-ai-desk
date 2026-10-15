-- Signing tokens and captured signatures are bearer secrets. The browser must
-- use the public signing endpoint, never read the raw signatures table.
alter table if exists public.signatures enable row level security;
drop policy if exists tenant_select on public.signatures;
revoke select on table public.signatures from anon, authenticated;
