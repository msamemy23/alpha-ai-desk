-- Built-in browser, part 2: approvals for actions that need a person, and paired desktop hosts.
--
-- browser_approvals       one row for each time the browser stops and asks. It holds a fingerprint of the exact action that
--                         was shown (the page, the control, where it goes and every entry), so an approval can only be used
--                         for that action, once, within ten minutes. Without this table the browser refuses to send, buy,
--                         delete, agree or download anything. It never guesses.
-- browser_hosts           a computer the shop paired with the browser (the optional desktop host). Only a hash of its
--                         pairing code and of its access token is kept.
-- browser_host_commands   what the app asked a paired computer to do, and what came back. Rows expire in minutes.
--
-- Only the server touches these tables (the /api/browser routes): row level security is on, nothing is granted to browser
-- roles, and every query the app runs is filtered by shop_id.
--
-- The app checks for these tables: until this runs, pages can be read and searched, and live pages can be looked at, filled in
-- and searched, but anything that needs approval is refused with a "needs a database update" note, and pairing a computer
-- is not offered.
-- Safe to run more than once. Not applied to production yet.

create table if not exists public.browser_approvals (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  requested_by uuid,
  actor text not null default 'user' check (actor in ('user', 'ai')),
  kind text not null check (kind in ('submit', 'purchase', 'send', 'download', 'delete', 'terms', 'open_site')),
  action_hash text not null check (action_hash ~ '^[0-9a-f]{64}$'),
  host text not null check (length(host) <= 253),
  url text not null check (length(url) <= 600),
  summary text not null check (length(summary) <= 800),
  details jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'used')),
  decided_by uuid,
  decided_at timestamptz,
  used_at timestamptz,
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  created_at timestamptz not null default now()
);
create index if not exists browser_approvals_shop_status_idx on public.browser_approvals (shop_id, status, expires_at);
create index if not exists browser_approvals_shop_created_idx on public.browser_approvals (shop_id, created_at desc);
alter table public.browser_approvals enable row level security;
revoke all on table public.browser_approvals from public, anon, authenticated;
grant all on table public.browser_approvals to service_role;
drop policy if exists browser_approvals_service_only on public.browser_approvals;
create policy browser_approvals_service_only on public.browser_approvals for all to service_role using (true) with check (true);

create table if not exists public.browser_hosts (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  status text not null default 'pairing' check (status in ('pairing', 'active', 'revoked')),
  pairing_code_hash text check (pairing_code_hash is null or pairing_code_hash ~ '^[0-9a-f]{64}$'),
  pairing_expires_at timestamptz,
  token_hash text check (token_hash is null or token_hash ~ '^[0-9a-f]{64}$'),
  platform text check (platform is null or length(platform) <= 60),
  app_version text check (app_version is null or length(app_version) <= 30),
  created_by uuid,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);
create unique index if not exists browser_hosts_token_hash_idx on public.browser_hosts (token_hash) where token_hash is not null;
create unique index if not exists browser_hosts_pairing_hash_idx on public.browser_hosts (pairing_code_hash) where pairing_code_hash is not null;
create index if not exists browser_hosts_shop_idx on public.browser_hosts (shop_id, status);
alter table public.browser_hosts enable row level security;
revoke all on table public.browser_hosts from public, anon, authenticated;
grant all on table public.browser_hosts to service_role;
drop policy if exists browser_hosts_service_only on public.browser_hosts;
create policy browser_hosts_service_only on public.browser_hosts for all to service_role using (true) with check (true);

create table if not exists public.browser_host_commands (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  host_id uuid not null references public.browser_hosts(id) on delete cascade,
  kind text not null check (kind in ('open', 'snapshot', 'click', 'fill', 'press', 'scroll')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'sent', 'done', 'failed', 'expired')),
  result jsonb,
  approval_id uuid references public.browser_approvals(id) on delete set null,
  requested_by uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '2 minutes'),
  done_at timestamptz
);
create index if not exists browser_host_commands_queue_idx on public.browser_host_commands (host_id, status, created_at);
alter table public.browser_host_commands enable row level security;
revoke all on table public.browser_host_commands from public, anon, authenticated;
grant all on table public.browser_host_commands to service_role;
drop policy if exists browser_host_commands_service_only on public.browser_host_commands;
create policy browser_host_commands_service_only on public.browser_host_commands for all to service_role using (true) with check (true);
