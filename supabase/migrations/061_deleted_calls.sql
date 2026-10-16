-- Deleted calls: a short "do not bring back" list for the call log.
--
-- The Inbox call log fills itself from three places: Telnyx recordings, the calls the AI answered, and the activity log. Each time Messages
-- opens it copies them in again. So when the owner deletes a call, removing the row is not enough: the next sync would put it straight back.
-- This table holds the id of every call the owner deleted; the sync skips those ids.
--
-- One new table, reached only through the server (/api/delete-call and the call sync): row level security is on, no policies exist, every grant is
-- revoked from everyone except the service role, and every query the app runs is filtered by shop_id. It holds no names, numbers or transcripts,
-- only the call's id, who deleted it and when. Nothing existing is changed: no table, column or policy is touched.
-- Until this runs, the Delete button answers "needs a database update" and deletes nothing. Safe to run more than once. Not applied to production yet.

create table if not exists public.deleted_calls (
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  call_id text not null check (length(call_id) between 1 and 200),
  deleted_by uuid,
  deleted_at timestamptz not null default now(),
  primary key (shop_id, call_id)
);
alter table public.deleted_calls enable row level security;
revoke all on table public.deleted_calls from public, anon, authenticated;
grant all on table public.deleted_calls to service_role;
