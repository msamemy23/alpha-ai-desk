-- Get more customers: one-off promotions, Google review replies the owner approves, and referral redemptions.
--
-- Every table is only reached through the server (the /api/growth routes): row level security is on, the tables are
-- revoked from everyone except the service role, and every query the app runs is filtered by shop_id.
--
-- The app checks for these tables. Until this runs, the Get more customers screen works as it does today and each new
-- feature shows a short "needs a database update" note. Safe to run more than once. Not applied to production yet.

-- A promotion is one message the owner wrote, aimed at a group they chose, sent now or at a set time.
-- The messages themselves live in automation_messages (migration 040) with campaign_id pointing here, so the
-- same history, limits, quiet hours and STOP handling apply.
create table if not exists public.growth_promotions (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  message text not null check (length(message) between 1 and 1000),
  email_subject text check (email_subject is null or length(email_subject) <= 150),
  audience jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'sending', 'sent', 'cancelled')),
  send_at timestamptz,
  queued_count integer not null default 0 check (queued_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  created_by uuid,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists growth_promotions_shop_created on public.growth_promotions (shop_id, created_at desc);
alter table public.growth_promotions enable row level security;
revoke all on table public.growth_promotions from public, anon, authenticated;
grant all on table public.growth_promotions to service_role;

-- Replies to Google reviews. Alpha drafts, the owner edits and approves, and the owner posts it on Google
-- themselves. Nothing here ever posts to Google. "posted" only records that the owner says they did.
create table if not exists public.review_replies (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  reviewer_name text check (reviewer_name is null or length(reviewer_name) <= 200),
  rating smallint not null check (rating between 1 and 5),
  review_text text not null default '' check (length(review_text) <= 5000),
  review_source text not null default 'pasted' check (review_source in ('pasted', 'google')),
  draft_text text not null default '' check (length(draft_text) <= 2000),
  final_text text check (final_text is null or length(final_text) <= 2000),
  drafted_by text not null default 'ai' check (drafted_by in ('ai', 'owner')),
  flags text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'approved', 'posted', 'dismissed')),
  approved_by uuid,
  approved_at timestamptz,
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists review_replies_shop_created on public.review_replies (shop_id, created_at desc);
alter table public.review_replies enable row level security;
revoke all on table public.review_replies from public, anon, authenticated;
grant all on table public.review_replies to service_role;

-- Each time a referral code was used: who was referred, which invoice, and what it was worth.
-- One invoice can only ever be credited to one referral, and one person can only be referred once.
create table if not exists public.referral_redemptions (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  code text not null check (length(code) between 3 and 40),
  referrer_customer_id uuid,
  referrer_name text check (referrer_name is null or length(referrer_name) <= 200),
  referred_customer_id uuid,
  referred_name text check (referred_name is null or length(referred_name) <= 200),
  document_id uuid,
  revenue numeric(12, 2) not null default 0 check (revenue >= 0),
  discount_amount numeric(12, 2) not null default 0 check (discount_amount >= 0),
  reward_given boolean not null default false,
  reward_note text check (reward_note is null or length(reward_note) <= 300),
  created_by uuid,
  created_at timestamptz not null default now()
);
create unique index if not exists referral_redemptions_document_once on public.referral_redemptions (shop_id, document_id) where document_id is not null;
create unique index if not exists referral_redemptions_person_once on public.referral_redemptions (shop_id, referred_customer_id) where referred_customer_id is not null;
create index if not exists referral_redemptions_shop_code on public.referral_redemptions (shop_id, code, created_at desc);
alter table public.referral_redemptions enable row level security;
revoke all on table public.referral_redemptions from public, anon, authenticated;
grant all on table public.referral_redemptions to service_role;

-- How many messages of each promotion are waiting, sent, failed, delivered and so on, counted in the database
-- so the promotions list does not have to download every message. Test messages never count.
create or replace function public.growth_campaign_counts(p_shop_id uuid, p_ids uuid[])
returns table (campaign_id uuid, status text, delivery_status text, n bigint, next_send_after timestamptz)
language sql
stable
set search_path = public
as $$
  select m.campaign_id, m.status, m.delivery_status, count(*)::bigint,
         min(m.send_after) filter (where m.status = 'queued')
  from public.automation_messages m
  where m.shop_id = p_shop_id and m.campaign_id = any(p_ids) and m.is_test = false
  group by m.campaign_id, m.status, m.delivery_status
$$;
revoke all on function public.growth_campaign_counts(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.growth_campaign_counts(uuid, uuid[]) to service_role;
