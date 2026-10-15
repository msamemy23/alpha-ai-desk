-- AI receptionist and text auto-reply: a readable history of what the assistant did, and the appointments it took.
--
--   ai_interactions      one row per call the assistant answered and one per text conversation it handled: who, when, what
--                        happened (outcome), the details it collected, which of the shop's rules fired, whether it needs a
--                        person, and the owner's review (good or bad). The unique key (shop_id, channel, ref_id) makes every
--                        write safe to repeat: a retried webhook never creates a second row or a second notification.
--   ai_booking_requests  appointment requests the assistant took, and times it booked itself, with the approval state.
--   message_media        pictures and video in texts: what customers sent (kept so they do not expire at the carrier), and
--                        pictures the shop attaches to an outgoing text until the carrier has fetched them.
--
-- Server-only (RLS on, service role only). Safe to run more than once. Not applied to production yet; the app works
-- without it and says which feature needs the update.

create table if not exists public.ai_interactions (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  channel text not null check (channel in ('call', 'sms')),
  -- The call id for a call; "sms:<contact>:<start>" for a text conversation.
  ref_id text not null check (length(ref_id) between 1 and 200),
  contact_key text not null default '',
  contact_phone text,
  contact_name text,
  customer_id uuid,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  outcome text not null default 'answered'
    check (outcome in ('answered', 'message_taken', 'booked', 'booking_requested', 'transferred', 'needs_person',
                       'spam', 'after_hours', 'missed', 'silent', 'draft', 'opt_out')),
  needs_person boolean not null default false,
  needs_reason text,
  needs_resolved_at timestamptz,
  summary text,
  captured jsonb not null default '{}'::jsonb,
  rules_fired text[] not null default '{}',
  detail jsonb not null default '{}'::jsonb,
  review text check (review is null or review in ('good', 'bad')),
  review_note text check (review_note is null or length(review_note) <= 500),
  reviewed_by uuid,
  reviewed_at timestamptz,
  seen_at timestamptz,
  summary_emailed_at timestamptz,
  alert_emailed_at timestamptz,
  textback_sent_at timestamptz,
  briefed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ai_interactions_ref_idx on public.ai_interactions (shop_id, channel, ref_id);
create index if not exists ai_interactions_recent_idx on public.ai_interactions (shop_id, started_at desc);
create index if not exists ai_interactions_contact_idx on public.ai_interactions (shop_id, channel, contact_key, updated_at desc);
create index if not exists ai_interactions_needs_idx
  on public.ai_interactions (shop_id, started_at desc) where needs_person and needs_resolved_at is null;

alter table public.ai_interactions enable row level security;
revoke all on table public.ai_interactions from public, anon, authenticated;
grant all on table public.ai_interactions to service_role;

create table if not exists public.ai_booking_requests (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  interaction_id uuid references public.ai_interactions(id) on delete set null,
  channel text not null check (channel in ('call', 'sms')),
  kind text not null check (kind in ('request', 'booked')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'booked', 'cancelled')),
  customer_id uuid,
  customer_name text,
  phone text,
  vehicle text,
  problem text,
  preferred_text text,
  slot_date date,
  slot_time text check (slot_time is null or slot_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  appointment_id uuid,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One booking row per conversation, so a repeated webhook cannot book twice. (Rows with no conversation are not limited.)
create unique index if not exists ai_booking_requests_interaction_idx
  on public.ai_booking_requests (shop_id, interaction_id);
create index if not exists ai_booking_requests_status_idx on public.ai_booking_requests (shop_id, status, created_at desc);

alter table public.ai_booking_requests enable row level security;
revoke all on table public.ai_booking_requests from public, anon, authenticated;
grant all on table public.ai_booking_requests to service_role;

create table if not exists public.message_media (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  message_id uuid,
  direction text not null check (direction in ('inbound', 'outbound')),
  content_type text not null check (content_type ~ '^(image|video)/[A-Za-z0-9.+-]+$'),
  -- Where the carrier hosts the original (inbound). It can expire, which is why a copy is kept in data.
  source_url text,
  -- The picture itself as base64, kept only when it is small enough (about 1.5 MB).
  data text check (data is null or length(data) <= 2200000),
  size_bytes integer,
  -- Random text that goes in the link the carrier fetches for an outgoing picture.
  token text,
  contact_key text,
  created_at timestamptz not null default now()
);

create index if not exists message_media_message_idx on public.message_media (shop_id, message_id);
create index if not exists message_media_contact_idx on public.message_media (shop_id, contact_key, created_at desc);

alter table public.message_media enable row level security;
revoke all on table public.message_media from public, anon, authenticated;
grant all on table public.message_media to service_role;
