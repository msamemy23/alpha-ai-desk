-- Parts purchasing: vendors and their prices, purchase orders and what arrived against them, core and warranty returns, extra
-- facts kept beside a part (barcode, order-up-to level, case size, core charge), the shop's price rules, and a record of every
-- change to a part's count, cost and price.
--
-- The inventory table itself is not changed. Its counts are still the single source of truth for what is on the shelf; the tables
-- here sit beside it, and the functions in migration 057 are the only things that change a count on the shop's behalf. Part ids
-- are plain uuid columns with no foreign key to inventory, so removing a part never fails and the history of a deleted part is kept.
--
-- Every table is only reached through the server (the /api/inventory routes): row level security is on, the tables are revoked
-- from everyone except the service role, and every query the app runs is filtered by shop_id.
--
-- The app checks for these tables: until this runs, the Parts list, reorder suggestions, shelf value and typed part-number lookup
-- work as they do today, and each feature that needs a table here shows a short "needs a database update" note.
-- Safe to run more than once. Not applied to production yet.

-- Who the shop buys from.
create table if not exists public.vendors (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  email text check (email is null or length(email) <= 254),
  phone text check (phone is null or length(phone) <= 40),
  contact text check (contact is null or length(contact) <= 120),
  account_number text check (account_number is null or length(account_number) <= 60),
  address text check (address is null or length(address) <= 300),
  terms text check (terms is null or length(terms) <= 120),
  lead_days integer check (lead_days is null or (lead_days >= 0 and lead_days <= 365)),
  notes text check (notes is null or length(notes) <= 1000),
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists vendors_one_name_per_shop on public.vendors (shop_id, lower(name));
alter table public.vendors enable row level security;
revoke all on table public.vendors from public, anon, authenticated;
grant all on table public.vendors to service_role;

-- Extra facts about a stocked part. One row per part, only for parts that have something set.
create table if not exists public.inventory_extras (
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  part_id uuid not null,
  barcode text check (barcode is null or length(barcode) <= 64),
  max_qty integer check (max_qty is null or (max_qty >= 0 and max_qty <= 1000000)),
  order_multiple integer check (order_multiple is null or (order_multiple >= 1 and order_multiple <= 10000)),
  core_charge numeric(10, 2) not null default 0 check (core_charge >= 0 and core_charge <= 100000),
  preferred_vendor_id uuid references public.vendors(id) on delete set null,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (shop_id, part_id)
);
create unique index if not exists inventory_extras_one_barcode on public.inventory_extras (shop_id, barcode) where barcode is not null and barcode <> '';
alter table public.inventory_extras enable row level security;
revoke all on table public.inventory_extras from public, anon, authenticated;
grant all on table public.inventory_extras to service_role;

-- What each vendor charges for a part, and when the shop last checked.
create table if not exists public.vendor_prices (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  part_id uuid not null,
  vendor_sku text check (vendor_sku is null or length(vendor_sku) <= 60),
  price numeric(10, 2) not null check (price >= 0 and price <= 1000000),
  core_charge numeric(10, 2) not null default 0 check (core_charge >= 0 and core_charge <= 100000),
  checked_on date,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  unique (vendor_id, part_id)
);
create index if not exists vendor_prices_shop_part on public.vendor_prices (shop_id, part_id);
alter table public.vendor_prices enable row level security;
revoke all on table public.vendor_prices from public, anon, authenticated;
grant all on table public.vendor_prices to service_role;

-- A counter per shop so two people never get the same purchase order number.
create table if not exists public.po_counters (
  shop_id uuid primary key references public.shop_profiles(id) on delete cascade,
  next_number integer not null default 1 check (next_number >= 1),
  updated_at timestamptz not null default now()
);
alter table public.po_counters enable row level security;
revoke all on table public.po_counters from public, anon, authenticated;
grant all on table public.po_counters to service_role;

-- Purchase orders. draft -> sent -> partial -> received, or cancelled.
create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  po_number text not null check (length(po_number) between 1 and 20),
  vendor_id uuid references public.vendors(id) on delete set null,
  vendor_name text not null default '' check (length(vendor_name) <= 120),
  status text not null default 'draft' check (status in ('draft', 'sent', 'partial', 'received', 'cancelled')),
  notes text check (notes is null or length(notes) <= 1000),
  expected_on date,
  -- Set the moment an email send starts, so a second tap or a second tab cannot send the same order twice.
  send_started_at timestamptz,
  sent_at timestamptz,
  sent_to text check (sent_to is null or length(sent_to) <= 300),
  sent_via text check (sent_via is null or sent_via in ('email', 'manual')),
  received_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  unique (shop_id, po_number)
);
create index if not exists purchase_orders_shop_status on public.purchase_orders (shop_id, status, created_at desc);
alter table public.purchase_orders enable row level security;
revoke all on table public.purchase_orders from public, anon, authenticated;
grant all on table public.purchase_orders to service_role;

create table if not exists public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  po_id uuid not null references public.purchase_orders(id) on delete cascade,
  position integer not null default 0,
  part_id uuid,
  description text not null check (length(description) between 1 and 200),
  sku text check (sku is null or length(sku) <= 60),
  qty integer not null check (qty >= 1 and qty <= 100000),
  unit_cost numeric(10, 2) not null check (unit_cost >= 0 and unit_cost <= 1000000),
  core_charge numeric(10, 2) not null default 0 check (core_charge >= 0 and core_charge <= 1000000),
  qty_received integer not null default 0 check (qty_received >= 0)
);
create index if not exists purchase_order_lines_po on public.purchase_order_lines (po_id, position);
create index if not exists purchase_order_lines_part on public.purchase_order_lines (shop_id, part_id) where part_id is not null;
alter table public.purchase_order_lines enable row level security;
revoke all on table public.purchase_order_lines from public, anon, authenticated;
grant all on table public.purchase_order_lines to service_role;

-- One row per delivery checked in. The receipt key is made by the screen when it opens the receiving sheet, so pressing the
-- button twice, or a slow connection retrying, counts the delivery once.
create table if not exists public.po_receipts (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  po_id uuid not null references public.purchase_orders(id) on delete cascade,
  receipt_key text not null check (length(receipt_key) between 8 and 80),
  cost_method text not null default 'keep' check (cost_method in ('keep', 'latest', 'average')),
  lines jsonb not null default '[]'::jsonb,
  received_by uuid,
  received_by_name text check (received_by_name is null or length(received_by_name) <= 120),
  received_at timestamptz not null default now(),
  unique (po_id, receipt_key)
);
create index if not exists po_receipts_po on public.po_receipts (po_id, received_at desc);
alter table public.po_receipts enable row level security;
revoke all on table public.po_receipts from public, anon, authenticated;
grant all on table public.po_receipts to service_role;

-- Every change to a part's counts, cost or price: who, when, from what, to what, and why.
create table if not exists public.part_history (
  id bigint generated always as identity primary key,
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  part_id uuid not null,
  at timestamptz not null default now(),
  actor_id uuid,
  actor_name text not null default '' check (length(actor_name) <= 120),
  field text not null check (field in ('qty_on_hand', 'qty_on_order', 'qty_reorder', 'cost', 'retail_price')),
  old_value numeric,
  new_value numeric,
  reason text not null default '' check (length(reason) <= 40),
  reference text not null default '' check (length(reference) <= 80),
  note text not null default '' check (length(note) <= 300)
);
create index if not exists part_history_part on public.part_history (shop_id, part_id, at desc);
create index if not exists part_history_recent on public.part_history (shop_id, at desc);
alter table public.part_history enable row level security;
revoke all on table public.part_history from public, anon, authenticated;
grant all on table public.part_history to service_role;

-- Cores to send back, warranty returns, wrong parts, and the credit the vendor owes for each.
create table if not exists public.part_returns (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  part_id uuid,
  vendor_id uuid references public.vendors(id) on delete set null,
  description text not null check (length(description) between 1 and 200),
  kind text not null default 'core' check (kind in ('core', 'warranty', 'wrong-part', 'overstock', 'damaged')),
  qty integer not null default 1 check (qty >= 1 and qty <= 100000),
  amount numeric(10, 2) not null default 0 check (amount >= 0 and amount <= 1000000),
  status text not null default 'open' check (status in ('open', 'shipped', 'credited', 'cancelled')),
  opened_on date not null default current_date,
  credited_on date,
  reference text check (reference is null or length(reference) <= 80),
  note text check (note is null or length(note) <= 500),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
create index if not exists part_returns_shop_status on public.part_returns (shop_id, status, opened_on desc);
alter table public.part_returns enable row level security;
revoke all on table public.part_returns from public, anon, authenticated;
grant all on table public.part_returns to service_role;

-- Markup and margin rules by cost range. One row per shop. Rules only suggest prices; nothing is repriced until the owner
-- looks at the list of changes and approves it.
create table if not exists public.pricing_rules (
  shop_id uuid primary key references public.shop_profiles(id) on delete cascade,
  rules jsonb not null default '{}'::jsonb check (jsonb_typeof(rules) = 'object'),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.pricing_rules enable row level security;
revoke all on table public.pricing_rules from public, anon, authenticated;
grant all on table public.pricing_rules to service_role;
