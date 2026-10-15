-- Texting that carriers allow: where each shop is in its sender registration.
--
-- US carriers block texts from an unregistered business number. A shop registers one of two ways:
--   10dlc      brand + campaign registration for a local number (takes days to weeks)
--   toll_free  verification of a toll-free number (takes days)
-- Both are done with the shop's Telnyx account and the shop's own business details; Alpha Desk cannot do them on its
-- behalf. This table only remembers the owner's checklist so the app can show what is done and what is left.
-- It never blocks the app: texting keeps working while a shop is registering.
--
-- No secrets and no tax ids are stored here: tick marks, dates, and reference numbers the owner chooses to keep.
-- Server-only (RLS on, service role only). Safe to run more than once. Not applied to production yet.

create table if not exists public.messaging_registration (
  shop_id uuid primary key references public.shop_profiles(id) on delete cascade,
  path text not null default 'unsure' check (path in ('unsure', '10dlc', 'toll_free')),
  status text not null default 'not_started'
    check (status in ('not_started', 'in_progress', 'submitted', 'approved', 'rejected')),
  -- { "<step id>": { "done": true, "at": "<iso time>" } }
  items jsonb not null default '{}'::jsonb,
  -- Reference numbers copied from the Telnyx portal: brand id, campaign id, verification request id.
  refs jsonb not null default '{}'::jsonb,
  notes text check (notes is null or length(notes) <= 2000),
  submitted_at timestamptz,
  approved_at timestamptz,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.messaging_registration enable row level security;
revoke all on table public.messaging_registration from public, anon, authenticated;
grant all on table public.messaging_registration to service_role;
