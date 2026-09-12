-- OAuth connector rows contain bearer and refresh tokens; browser clients
-- use the server API and must not query or mutate this table directly.
revoke select, insert, update, delete on table public.connectors from anon, authenticated;