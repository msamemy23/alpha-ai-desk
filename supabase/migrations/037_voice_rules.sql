-- AI receptionist and text auto-reply: the rules each shop sets, plus the small pieces of Inbox state that
-- belong next to them.
--
--   voice_rules        one row per shop: tone, greeting, hours, who to hand off to, what the assistant may and may not do,
--                      the master switches for calls and texts, quiet hours. Stored as one JSON document that the app
--                      validates before it saves it (src/lib/voice/rules.ts).
--   ai_thread_state    per phone number: "a person took over, so the assistant stays quiet until ...", "this thread needs a
--                      person", and the small conversation notes the assistant keeps between texts.
--   message_templates  the shop's saved replies for the Inbox composer.
--   thread_assignments who on the team is handling a text conversation.
--
-- Server-only: the browser reads and writes these through /api/receptionist/* and /api/inbox/*, never directly, so RLS is
-- on and nobody but the service role has any grant. Every row carries the shop id.
--
-- Safe to run more than once. Not applied to production yet; the app works without it (it uses safe built-in defaults
-- and tells the owner that saving the rules needs this update).

create table if not exists public.voice_rules (
  shop_id uuid primary key references public.shop_profiles(id) on delete cascade,
  rules jsonb not null default '{}'::jsonb,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'voice_rules_size_check' and conrelid = 'public.voice_rules'::regclass
  ) then
    alter table public.voice_rules add constraint voice_rules_size_check check (length(rules::text) <= 60000);
  end if;
end $$;

alter table public.voice_rules enable row level security;
revoke all on table public.voice_rules from public, anon, authenticated;
grant all on table public.voice_rules to service_role;

create table if not exists public.ai_thread_state (
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  channel text not null default 'sms' check (channel in ('sms', 'call')),
  -- The last ten digits of the customer's number, so "(713) 555-0142" and "+17135550142" are the same thread.
  contact_key text not null check (length(contact_key) between 4 and 20),
  paused_until timestamptz,
  pause_reason text check (pause_reason is null or pause_reason in ('human_takeover', 'manual', 'needs_person', 'rate_limit')),
  needs_person boolean not null default false,
  needs_reason text,
  needs_since timestamptz,
  convo jsonb not null default '{}'::jsonb,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (shop_id, channel, contact_key)
);

create index if not exists ai_thread_state_needs_idx
  on public.ai_thread_state (shop_id, needs_since desc) where needs_person;

alter table public.ai_thread_state enable row level security;
revoke all on table public.ai_thread_state from public, anon, authenticated;
grant all on table public.ai_thread_state to service_role;

create table if not exists public.message_templates (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  title text not null check (length(title) between 1 and 60),
  body text not null check (length(body) between 1 and 1000),
  sort_order integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists message_templates_shop_idx on public.message_templates (shop_id, sort_order, created_at);

alter table public.message_templates enable row level security;
revoke all on table public.message_templates from public, anon, authenticated;
grant all on table public.message_templates to service_role;

create table if not exists public.thread_assignments (
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  contact_key text not null check (length(contact_key) between 4 and 20),
  -- The team member's id from the Team list (a number kept as text), and their name as it was when assigned.
  assignee_id text not null check (length(assignee_id) between 1 and 40),
  assignee_name text not null check (length(assignee_name) between 1 and 80),
  assigned_by uuid,
  assigned_at timestamptz not null default now(),
  primary key (shop_id, contact_key)
);

create index if not exists thread_assignments_assignee_idx on public.thread_assignments (shop_id, assignee_id);

alter table public.thread_assignments enable row level security;
revoke all on table public.thread_assignments from public, anon, authenticated;
grant all on table public.thread_assignments to service_role;
