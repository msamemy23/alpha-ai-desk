-- Stop button that really stops the server.
--
-- When someone presses Stop, the browser records the request here, keyed by the conversation and the
-- turn it was working on. The server checks this table between steps (before each model call and
-- before each look-up) and stops planning. An approved change that has already started is never
-- interrupted, so a Stop can never leave a change half done.
--
-- Only the server touches this table. Rows are tiny and are only read for the last few minutes; nothing
-- here is deleted automatically.
-- The app checks for this table: until this runs, Stop still cancels in the browser and on the same
-- server instance, it just cannot reach a different one.
-- Safe to run more than once. Not applied to production yet.

create table if not exists public.ai_run_cancels (
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  user_id uuid not null,
  session_id text not null check (length(session_id) between 1 and 128),
  turn_id text not null check (length(turn_id) between 1 and 160),
  requested_at timestamptz not null default now(),
  primary key (shop_id, user_id, session_id, turn_id)
);

alter table public.ai_run_cancels enable row level security;
revoke all on table public.ai_run_cancels from public, anon, authenticated;
grant all on table public.ai_run_cancels to service_role;

create index if not exists ai_run_cancels_shop_requested_idx
  on public.ai_run_cancels (shop_id, requested_at desc);
