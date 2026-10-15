-- Built-in browser, part 1: the shop's own settings, its allow and block lists, and its saved sites.
--
-- browser_settings   one row per shop: open to any public site or only the sites the shop allowed, whether Alpha (the AI)
--                    may use the browser, and whether reader view shows pictures.
-- browser_site_rules sites the shop always allows or always blocks. A rule for a site covers its sub-sites. The built-in
--                    default block list (banks, payments, webmail, adult, gambling, piracy) lives in the app, not here.
-- browser_bookmarks  the shop's quick sites and saved pages (parts vendors, recall and VIN sites, repair information).
--
-- Only the server touches these tables (the /api/browser routes): row level security is on, nothing is granted to browser
-- roles, and every query the app runs is filtered by shop_id.
--
-- The app checks for these tables: until this runs, the browser still works with its built-in default settings and a
-- built-in list of quick sites, and the settings, rules and saved sites show a short "needs a database update" note.
-- Safe to run more than once. Not applied to production yet.

create table if not exists public.browser_settings (
  shop_id uuid primary key references public.shop_profiles(id) on delete cascade,
  mode text not null default 'open' check (mode in ('open', 'allowlist')),
  ai_enabled boolean not null default true,
  reader_images boolean not null default true,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.browser_settings enable row level security;
revoke all on table public.browser_settings from public, anon, authenticated;
grant all on table public.browser_settings to service_role;
drop policy if exists browser_settings_service_only on public.browser_settings;
create policy browser_settings_service_only on public.browser_settings for all to service_role using (true) with check (true);

create table if not exists public.browser_site_rules (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  host text not null check (length(host) between 3 and 253 and host = lower(host)),
  rule text not null check (rule in ('allow', 'block')),
  note text check (note is null or length(note) <= 200),
  created_by uuid,
  created_at timestamptz not null default now()
);
create unique index if not exists browser_site_rules_one_per_host on public.browser_site_rules (shop_id, host);
alter table public.browser_site_rules enable row level security;
revoke all on table public.browser_site_rules from public, anon, authenticated;
grant all on table public.browser_site_rules to service_role;
drop policy if exists browser_site_rules_service_only on public.browser_site_rules;
create policy browser_site_rules_service_only on public.browser_site_rules for all to service_role using (true) with check (true);

create table if not exists public.browser_bookmarks (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  title text not null check (length(title) between 1 and 80),
  url text not null check (length(url) between 8 and 2048),
  kind text not null default 'quick' check (kind in ('quick', 'saved')),
  position integer not null default 0 check (position >= 0 and position <= 10000),
  created_by uuid,
  created_at timestamptz not null default now()
);
create unique index if not exists browser_bookmarks_one_per_url on public.browser_bookmarks (shop_id, kind, url);
create index if not exists browser_bookmarks_shop_idx on public.browser_bookmarks (shop_id, kind, position, created_at);
alter table public.browser_bookmarks enable row level security;
revoke all on table public.browser_bookmarks from public, anon, authenticated;
grant all on table public.browser_bookmarks to service_role;
drop policy if exists browser_bookmarks_service_only on public.browser_bookmarks;
create policy browser_bookmarks_service_only on public.browser_bookmarks for all to service_role using (true) with check (true);
