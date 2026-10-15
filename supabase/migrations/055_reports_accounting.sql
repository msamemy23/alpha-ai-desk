-- Reports and accounting: how the shop keeps its books, the accounts an accountant file uses, bills and expenses, saved and
-- scheduled reports, and the month-end close.
--
-- Nothing here changes an invoice, a payment or any amount already stored. The report screens only READ documents and payments;
-- these tables hold the shop's own choices (which accounts to use, what tax authorities it pays, which bills it entered) and the
-- record of what was emailed. Every table is only reached through the server (the /api/accounting and /api/reports routes): row
-- level security is on, the tables are revoked from everyone except the service role, and every query the app runs is filtered by
-- shop_id.
--
-- The app checks for these tables: until this runs, the reports work as they do today and each feature that needs a table here
-- (account names, bills, saved reports, the close checklist) shows a short "needs a database update" note. Safe to run more than
-- once. Not applied to production yet.

-- How the shop wants its books read. One row per shop.
create table if not exists public.accounting_settings (
  shop_id uuid primary key references public.shop_profiles(id) on delete cascade,
  basis text not null default 'accrual' check (basis in ('accrual', 'cash')),
  -- Where the cost of parts comes from in profit and loss: the cost written on each invoice, or the parts bills entered.
  cogs_method text not null default 'invoices' check (cogs_method in ('invoices', 'purchases')),
  -- Sales tax split by authority: [{ "name": "State", "ratePct": 6.25, "agency": "..." }, ...]. Never changes what a customer was charged.
  tax_components jsonb not null default '[]'::jsonb check (jsonb_typeof(tax_components) = 'array' and jsonb_array_length(tax_components) <= 12),
  -- What an hour of a technician costs the shop, used only to estimate profit per job. Null when it is not known.
  labor_cost_per_hour numeric(8, 2) check (labor_cost_per_hour is null or (labor_cost_per_hour >= 0 and labor_cost_per_hour <= 1000)),
  journal_mode text not null default 'individual' check (journal_mode in ('individual', 'daily')),
  include_cost boolean not null default false,
  daily_customer text not null default 'Daily sales' check (length(daily_customer) <= 60),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.accounting_settings enable row level security;
revoke all on table public.accounting_settings from public, anon, authenticated;
grant all on table public.accounting_settings to service_role;

-- The account names the shop's accountant or QuickBooks already uses, one row per kind of money (sales, tax, cash, and so on).
create table if not exists public.account_mappings (
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  key text not null check (length(key) between 1 and 40),
  account_name text not null check (length(account_name) between 1 and 100),
  account_number text check (account_number is null or length(account_number) <= 20),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (shop_id, key)
);
alter table public.account_mappings enable row level security;
revoke all on table public.account_mappings from public, anon, authenticated;
grant all on table public.account_mappings to service_role;

-- Bills and expenses. A row with no paid_on day is a bill still to pay. Nothing is deleted: a mistake is voided and stays on record.
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  date date not null,
  vendor text not null check (length(vendor) between 1 and 120),
  category text not null check (length(category) between 1 and 40),
  amount numeric(12, 2) not null check (amount > 0 and amount <= 10000000),
  memo text check (memo is null or length(memo) <= 400),
  reference text check (reference is null or length(reference) <= 60),
  paid_on date,
  method text check (method is null or length(method) <= 30),
  voided_at timestamptz,
  voided_by uuid,
  void_reason text check (void_reason is null or length(void_reason) <= 300),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  constraint expenses_paid_after_bill check (paid_on is null or paid_on >= date)
);
create index if not exists expenses_shop_date on public.expenses (shop_id, date desc);
create index if not exists expenses_shop_unpaid on public.expenses (shop_id, date) where paid_on is null and voided_at is null;
alter table public.expenses enable row level security;
revoke all on table public.expenses from public, anon, authenticated;
grant all on table public.expenses to service_role;

-- Reports the owner saved by name. A scheduled one is emailed to the addresses the owner typed in (never to customers).
create table if not exists public.saved_reports (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  kind text not null check (kind in ('summary', 'sales', 'profit', 'receivables', 'tax')),
  range jsonb not null default '{"key":"30d"}'::jsonb,
  compare jsonb not null default '{"mode":"previous"}'::jsonb,
  schedule text not null default 'none' check (schedule in ('none', 'weekly', 'monthly')),
  recipients jsonb not null default '[]'::jsonb check (jsonb_typeof(recipients) = 'array' and jsonb_array_length(recipients) <= 5),
  enabled boolean not null default false,
  -- The period key of the last scheduled send, or of the period that was current when the schedule was turned on.
  last_period text,
  last_sent_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
create index if not exists saved_reports_shop on public.saved_reports (shop_id, created_at desc);
create index if not exists saved_reports_shop_schedule on public.saved_reports (shop_id) where enabled and schedule <> 'none';
alter table public.saved_reports enable row level security;
revoke all on table public.saved_reports from public, anon, authenticated;
grant all on table public.saved_reports to service_role;

-- Everything a report email did: claimed, sent, failed, or unknown (it was started and the outcome was never recorded; it is
-- never sent again on its own). The unique index is what keeps a scheduled period from going out twice.
create table if not exists public.report_send_log (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  saved_report_id uuid references public.saved_reports(id) on delete set null,
  report_name text not null default '' check (length(report_name) <= 80),
  kind text not null default 'summary',
  trigger text not null check (trigger in ('schedule', 'manual', 'test')),
  period_key text,
  period_title text not null default '' check (length(period_title) <= 120),
  recipients jsonb not null default '[]'::jsonb,
  subject text not null default '' check (length(subject) <= 200),
  status text not null default 'claimed' check (status in ('claimed', 'sent', 'failed', 'unknown')),
  attempts integer not null default 1,
  error text check (error is null or length(error) <= 500),
  -- A key the screen makes when it opens the send sheet, so pressing Send twice sends once.
  send_key text check (send_key is null or length(send_key) <= 80),
  created_by uuid,
  created_at timestamptz not null default now(),
  claimed_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists report_send_log_shop on public.report_send_log (shop_id, created_at desc);
create unique index if not exists report_send_log_one_period on public.report_send_log (saved_report_id, period_key)
  where trigger = 'schedule' and saved_report_id is not null and period_key is not null;
create unique index if not exists report_send_log_one_key on public.report_send_log (shop_id, send_key) where send_key is not null;
alter table public.report_send_log enable row level security;
revoke all on table public.report_send_log from public, anon, authenticated;
grant all on table public.report_send_log to service_role;

-- The month-end checklist: what was checked, a note, and the totals as they stood when the month was closed. Closing records
-- that the month was reviewed; it does not lock invoices.
create table if not exists public.month_closes (
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  month text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  checked jsonb not null default '{}'::jsonb check (jsonb_typeof(checked) = 'object'),
  note text check (note is null or length(note) <= 1000),
  snapshot jsonb,
  closed_at timestamptz,
  closed_by uuid,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (shop_id, month)
);
alter table public.month_closes enable row level security;
revoke all on table public.month_closes from public, anon, authenticated;
grant all on table public.month_closes to service_role;
