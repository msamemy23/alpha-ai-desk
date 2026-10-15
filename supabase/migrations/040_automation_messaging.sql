-- Automation messaging: one row for every message an automation queues, sends, skips or cancels.
--
-- Why a table of its own: the automations screen needs to show, before anything goes out, who will be
-- texted and who is skipped and why, and afterwards a readable history with the outcome for each
-- person. The same rows are the queue (so pausing an automation can cancel what is waiting), the
-- per-customer frequency record, and the source for "sent, replied, booked, revenue".
--
-- Server-only: the browser reads these rows through /api/system-automations and /api/automations/*,
-- never directly, so RLS is on and nobody but the service role has any grant.
--
-- Also adds:
--   email_opt_outs       people who unsubscribed from emails the shop sends (leads and customers)
--   scheduler_heartbeats when the background scheduler last ran, so the screen can say how often
--                        automations really get a chance to run
--
-- Safe to run more than once. Not applied to production yet.

create table if not exists public.automation_messages (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  automation_id text not null check (length(automation_id) between 1 and 80),
  run_id uuid,
  campaign_id uuid,
  channel text not null default 'sms' check (channel in ('sms', 'email')),
  message_class text not null default 'service' check (message_class in ('service', 'marketing')),
  status text not null default 'queued'
    check (status in ('queued', 'sending', 'sent', 'failed', 'skipped', 'cancelled', 'unknown')),
  skip_reason text,
  customer_id uuid,
  recipient_name text,
  recipient text,
  subject text,
  body text,
  source_type text,
  source_id text,
  -- One message per thing it is about. Rows that may still send carry the plain key. Skipped rows
  -- carry a namespaced key (skip:<key>:<reason>) so the same skip is logged once, and cancelled rows
  -- clear it, so neither can block a later, legitimate send.
  dedupe_key text,
  send_after timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz,
  provider_message_id text,
  -- What the phone company reported after accepting a text: delivered, or why not. Filled in by the delivery webhook.
  delivery_status text check (delivery_status is null or delivery_status in ('delivered', 'undelivered', 'failed')),
  delivered_at timestamptz,
  last_error text,
  is_test boolean not null default false,
  detail jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists automation_messages_provider_idx
  on public.automation_messages (provider_message_id) where provider_message_id is not null;
create unique index if not exists automation_messages_dedupe_idx
  on public.automation_messages (shop_id, dedupe_key);
create index if not exists automation_messages_queue_idx
  on public.automation_messages (shop_id, status, send_after);
create index if not exists automation_messages_history_idx
  on public.automation_messages (shop_id, automation_id, created_at desc);
create index if not exists automation_messages_customer_idx
  on public.automation_messages (shop_id, customer_id, created_at desc);

alter table public.automation_messages enable row level security;
revoke all on table public.automation_messages from public, anon, authenticated;
grant all on table public.automation_messages to service_role;

-- Emails: a person who clicks unsubscribe in any email from the shop is never emailed marketing again.
create table if not exists public.email_opt_outs (
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  email_lower text not null check (length(email_lower) between 3 and 254),
  source text,
  created_at timestamptz not null default now(),
  primary key (shop_id, email_lower)
);

alter table public.email_opt_outs enable row level security;
revoke all on table public.email_opt_outs from public, anon, authenticated;
grant all on table public.email_opt_outs to service_role;

-- The scheduler writes one row each time it wakes up. No shop data.
create table if not exists public.scheduler_heartbeats (
  name text primary key check (length(name) between 1 and 80),
  last_tick_at timestamptz not null default now(),
  detail jsonb not null default '{}'::jsonb
);

alter table public.scheduler_heartbeats enable row level security;
revoke all on table public.scheduler_heartbeats from public, anon, authenticated;
grant all on table public.scheduler_heartbeats to service_role;
