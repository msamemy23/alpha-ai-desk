-- Customers: tags and contact choices, a notes feed, fleet accounts, the merge log, import batches and a consent history.
--
-- Nothing here changes the customers table or the rows that point at it. Every table is only reached through the server
-- (the /api/customers routes), so the browser gets no access: row level security is on, the tables are revoked from
-- everyone except the service role, and every query the app runs is filtered by shop_id.
--
-- The app checks for these tables: until this runs, the Customers screen works as it does today and each new feature shows a
-- short "needs a database update" note. A customer merge needs customer_merges, so it stays off until then. Safe to run more
-- than once. Not applied to production yet.

-- Tags and how a customer likes to be reached. One row per customer, created the first time something is saved.
create table if not exists public.customer_meta (
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  customer_id uuid not null,
  tags text[] not null default '{}' check (cardinality(tags) <= 12),
  preferred_channel text check (preferred_channel is null or preferred_channel in ('call', 'text', 'email')),
  best_time text check (best_time is null or length(best_time) <= 120),
  do_not_call boolean not null default false,
  do_not_email boolean not null default false,
  account_id uuid,
  account_role text check (account_role is null or length(account_role) <= 80),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (shop_id, customer_id)
);
create index if not exists customer_meta_shop_account on public.customer_meta (shop_id, account_id) where account_id is not null;
alter table public.customer_meta enable row level security;
revoke all on table public.customer_meta from public, anon, authenticated;
grant all on table public.customer_meta to service_role;

-- A running list of notes on a customer, separate from the one notes box on the card. Notes are archived, never erased.
create table if not exists public.customer_notes (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  customer_id uuid not null,
  body text not null check (length(body) between 1 and 2000),
  pinned boolean not null default false,
  author_id uuid,
  author_name text check (author_name is null or length(author_name) <= 200),
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create index if not exists customer_notes_shop_customer on public.customer_notes (shop_id, customer_id, created_at desc);
alter table public.customer_notes enable row level security;
revoke all on table public.customer_notes from public, anon, authenticated;
grant all on table public.customer_notes to service_role;

-- Fleet and business accounts: one company with several drivers and vehicles.
create table if not exists public.customer_accounts (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  name text not null check (length(name) between 1 and 160),
  kind text not null default 'fleet' check (kind in ('fleet', 'business')),
  contact_name text check (contact_name is null or length(contact_name) <= 160),
  contact_phone text check (contact_phone is null or length(contact_phone) <= 40),
  contact_email text check (contact_email is null or length(contact_email) <= 200),
  billing_address text check (billing_address is null or length(billing_address) <= 400),
  terms_days integer check (terms_days is null or terms_days between 0 and 120),
  po_required boolean not null default false,
  notes text check (notes is null or length(notes) <= 2000),
  created_by uuid,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create unique index if not exists customer_accounts_shop_name on public.customer_accounts (shop_id, lower(name)) where archived_at is null;
alter table public.customer_accounts enable row level security;
revoke all on table public.customer_accounts from public, anon, authenticated;
grant all on table public.customer_accounts to service_role;

-- The record of every customer merge: a full copy of the card that was merged away, the values that changed on the kept
-- card and the id of every record that moved. Undo uses it to put everything back exactly.
create table if not exists public.customer_merges (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  keep_id uuid not null,
  remove_id uuid not null,
  status text not null default 'started' check (status in ('started', 'done', 'failed', 'undone')),
  keep_before jsonb not null,
  remove_snapshot jsonb not null,
  patch jsonb not null default '{}'::jsonb,
  moved jsonb not null default '{}'::jsonb,
  carry_record_id uuid,
  meta_before jsonb,
  error text check (error is null or length(error) <= 1000),
  created_by uuid,
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  undone_by uuid,
  check (keep_id <> remove_id)
);
create index if not exists customer_merges_shop_when on public.customer_merges (shop_id, created_at desc);
alter table public.customer_merges enable row level security;
revoke all on table public.customer_merges from public, anon, authenticated;
grant all on table public.customer_merges to service_role;

-- One row per customer list that was imported, so the same file is not added twice and the owner can see what came in.
create table if not exists public.customer_imports (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  batch_key text not null check (length(batch_key) between 8 and 80),
  file_name text check (file_name is null or length(file_name) <= 200),
  total_rows integer not null default 0,
  added integer not null default 0,
  skipped integer not null default 0,
  invalid integer not null default 0,
  created_ids jsonb not null default '[]'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (shop_id, batch_key)
);
alter table public.customer_imports enable row level security;
revoke all on table public.customer_imports from public, anon, authenticated;
grant all on table public.customer_imports to service_role;

-- Who changed a customer's contact permission, when, and why. The actual text opt-out lives in sms_consents (migration 032).
create table if not exists public.customer_consent_events (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  customer_id uuid not null,
  channel text not null check (channel in ('sms', 'call', 'email')),
  status text not null check (status in ('opted_out', 'opted_in', 'do_not_contact', 'cleared')),
  source text not null check (length(source) between 1 and 40),
  reason text check (reason is null or length(reason) <= 500),
  actor uuid,
  created_at timestamptz not null default now()
);
create index if not exists customer_consent_events_shop_customer on public.customer_consent_events (shop_id, customer_id, created_at desc);
alter table public.customer_consent_events enable row level security;
revoke all on table public.customer_consent_events from public, anon, authenticated;
grant all on table public.customer_consent_events to service_role;
