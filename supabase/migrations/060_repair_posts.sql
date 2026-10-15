-- Repair posts: Alpha prepares social posts from finished jobs, the owner approves them (Suggest) or lets them go out on their own (Auto).
--
-- Three new tables, all reached only through the server (the /api/growth/post-queue and /api/growth/post-photos routes):
-- row level security is on, no policies exist, every grant is revoked from everyone except the service role, and every query the app runs is
-- filtered by shop_id.
--
--   post_settings   one row per shop: Off / Suggest / Auto, the weekly limit, and where posts go.
--   job_post_info   per job: whether the customer said yes to a post (default NO), the photos the owner already checked, and "how did you hear about us".
--   post_queue      every post: its photos, words, who made it, who sent it, what each app answered, and the numbers the apps reported.
--
-- The app checks for these tables. Until this runs, the Posts screen shows a short "needs a database update" note, the Write a post sheet works as it
-- does today, and nothing is ever posted automatically. Nothing else changes: no existing table, column or policy is touched.
-- Safe to run more than once. Not applied to production yet.

create table if not exists public.post_settings (
  shop_id uuid primary key references public.shop_profiles(id) on delete cascade,
  mode text not null default 'off' check (mode in ('off', 'suggest', 'auto')),
  weekly_cap smallint not null default 3 check (weekly_cap between 1 and 14),
  platforms text[] not null default '{}' check (platforms <@ array['facebook', 'instagram', 'google']::text[]),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.post_settings enable row level security;
revoke all on table public.post_settings from public, anon, authenticated;
grant all on table public.post_settings to service_role;

-- The customer's yes is per job and starts as NO. "cleared" holds the pictures the owner already checked for plates and VINs:
-- [{ "ref": "storage:<inspection>/<file>.jpg", "path": "<shop>/<file>.jpg", "covered": false, "label": "Front brake pads", "by": "<user>", "at": "<time>" }]
create table if not exists public.job_post_info (
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  job_id uuid not null,
  customer_ok boolean not null default false,
  ok_note text check (ok_note is null or length(ok_note) <= 300),
  ok_by uuid,
  ok_at timestamptz,
  heard_from text check (heard_from is null or length(heard_from) <= 120),
  heard_from_at timestamptz,
  cleared jsonb not null default '[]'::jsonb check (jsonb_typeof(cleared) = 'array' and jsonb_array_length(cleared) <= 40),
  updated_at timestamptz not null default now(),
  primary key (shop_id, job_id)
);
alter table public.job_post_info enable row level security;
revoke all on table public.job_post_info from public, anon, authenticated;
grant all on table public.job_post_info to service_role;

-- One row per post. This table is also the log: nothing is deleted when a post is skipped, cancelled, fails or goes out.
create table if not exists public.post_queue (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  job_id uuid,
  source text not null default 'job' check (source in ('job', 'device')),
  state text not null default 'needs_review' check (state in ('needs_review', 'ready', 'scheduled', 'posting', 'posted', 'partly_posted', 'failed', 'skipped', 'cancelled')),
  caption text not null default '' check (length(caption) <= 5000),
  facts jsonb,
  photos jsonb not null default '[]'::jsonb check (jsonb_typeof(photos) = 'array' and jsonb_array_length(photos) <= 10),
  platforms text[] not null default '{}' check (platforms <@ array['facebook', 'instagram', 'google']::text[]),
  flags text[] not null default '{}',
  made_by text not null default 'owner' check (made_by in ('owner', 'alpha', 'ask_alpha')),
  photos_checked_at timestamptz,
  photos_checked_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  decided_by text check (decided_by is null or decided_by in ('owner', 'auto', 'ask_alpha')),
  post_at timestamptz,
  hold_until timestamptz,
  attempt integer not null default 0 check (attempt >= 0),
  results jsonb not null default '[]'::jsonb check (jsonb_typeof(results) = 'array'),
  metrics jsonb not null default '{}'::jsonb check (jsonb_typeof(metrics) = 'object'),
  error text check (error is null or length(error) <= 1000),
  posted_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source = 'device' or job_id is not null)
);
-- A job never has two posts waiting at once, whatever two taps or two runs do at the same moment.
create unique index if not exists post_queue_one_open_per_job on public.post_queue (shop_id, job_id)
  where job_id is not null and state in ('needs_review', 'ready', 'scheduled', 'posting');
create index if not exists post_queue_shop_created on public.post_queue (shop_id, created_at desc);
create index if not exists post_queue_shop_state on public.post_queue (shop_id, state);
alter table public.post_queue enable row level security;
revoke all on table public.post_queue from public, anon, authenticated;
grant all on table public.post_queue to service_role;
