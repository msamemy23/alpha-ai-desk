alter table public.growth_campaigns
  add column if not exists service text,
  add column if not exists daily_budget numeric,
  add column if not exists duration_days integer,
  add column if not exists target_area text,
  add column if not exists ad_copy jsonb,
  add column if not exists fb_ids jsonb,
  add column if not exists clicks integer not null default 0,
  add column if not exists impressions integer not null default 0;

update public.growth_campaigns
set daily_budget = budget_per_day
where daily_budget is null and budget_per_day is not null;

alter table public.growth_campaigns enable row level security;
revoke all on table public.growth_campaigns from anon;
