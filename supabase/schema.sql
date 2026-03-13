-- ============================================================
-- Alpha AI Desk — Supabase Schema
-- Paste this entire file into Supabase SQL Editor and click Run
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ── Settings ─────────────────────────────────────────────────
create table if not exists settings (
  id uuid primary key default uuid_generate_v4(),
  shop_name text default 'Alpha International Auto Center',
  shop_address text default '10710 S Main St, Houston, TX 77025',
  shop_phone text default '(713) 663-6979',
  shop_email text default 'service@alphainternationalauto.com',
  labor_rate numeric default 120,
  tax_rate numeric default 8.25,
  warranty_months integer default 12,
  payment_terms text default 'Due on receipt',
  payment_methods text default 'Cash, Card, Zelle, Cash App',
  disclaimer text default 'Vehicle must be picked up within 3 days of completion.',
  techs text[] default array['Paul','Devin','Luis','Louie'],
  ai_api_key text default '',
  ai_model text default 'meta-llama/llama-3.3-70b-instruct:free',
  ai_base_url text default 'https://openrouter.ai/api/v1',
  telnyx_api_key text default '',
  telnyx_phone_number text default '',
  resend_api_key text default '',
  from_email text default 'noreply@alphainternationalauto.com',
  updated_at timestamptz default now()
);

-- Seed one settings row
insert into settings (id) values (uuid_generate_v4())
on conflict do nothing;

-- ── Customers ─────────────────────────────────────────────────
create table if not exists customers (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  phone text,
  email text,
  address text,
  preferred_contact text default 'Call',
  vehicle_year text,
  vehicle_make text,
  vehicle_model text,
  vehicle_vin text,
  vehicle_plate text,
  vehicle_mileage text,
  notes text,
  tags text[],
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── Jobs ──────────────────────────────────────────────────────
create table if not exists jobs (
  id uuid primary key default uuid_generate_v4(),
  customer_id uuid references customers(id) on delete set null,
  customer_name text,
  concern text,
  tech text,
  status text default 'New',
  priority text default 'Normal',
  vehicle_year text,
  vehicle_make text,
  vehicle_model text,
  vehicle_vin text,
  vehicle_plate text,
  vehicle_mileage text,
  promise_date date,
  parts jsonb default '[]',
  labors jsonb default '[]',
  internal_notes text,
  customer_notes text,
  is_insurance boolean default false,
  insurance_company text,
  claim_number text,
  adjuster_name text,
  adjuster_phone text,
  deductible numeric,
  supplement_status text,
  locked boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── Documents ─────────────────────────────────────────────────
create table if not exists documents (
  id uuid primary key default uuid_generate_v4(),
  type text not null check (type in ('Estimate','Invoice','Receipt')),
  doc_number text,
  status text default 'Draft',
  doc_date date default current_date,
  due_date date,
  expires_date date,
  customer_id uuid references customers(id) on delete set null,
  customer_name text,
  job_id uuid references jobs(id) on delete set null,
  vehicle_year text,
  vehicle_make text,
  vehicle_model text,
  vehicle_vin text,
  vehicle_plate text,
  vehicle_mileage text,
  parts jsonb default '[]',
  labors jsonb default '[]',
  shop_supplies numeric default 0,
  sublet numeric default 0,
  tax_rate numeric default 8.25,
  apply_tax boolean default true,
  deposit numeric default 0,
  amount_paid numeric,
  payment_method text,
  cashier text,
  payment_terms text,
  payment_methods text,
  warranty_type text default 'No Warranty',
  warranty_months integer,
  warranty_mileage text,
  warranty_start date,
  warranty_exclusions text,
  warranty_claim text,
  notes text,
  locked boolean default false,
  sent_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── Messages (SMS + Email) ────────────────────────────────────
create table if not exists messages (
  id uuid primary key default uuid_generate_v4(),
  direction text not null check (direction in ('inbound','outbound')),
  channel text not null check (channel in ('sms','email')),
  from_address text,
  to_address text,
  subject text,
  body text not null,
  status text default 'delivered',
  customer_id uuid references customers(id) on delete set null,
  job_id uuid references jobs(id) on delete set null,
  document_id uuid references documents(id) on delete set null,
  telnyx_message_id text,
  ai_handled boolean default false,
  read boolean default false,
  attachments jsonb default '[]',
  created_at timestamptz default now()
);

-- ── Activities / Calls ────────────────────────────────────────
create table if not exists activities (
  id uuid primary key default uuid_generate_v4(),
  type text default 'call',
  direction text,
  customer_id uuid references customers(id) on delete set null,
  customer_name text,
  job_id uuid references jobs(id) on delete set null,
  phone text,
  duration integer,
  summary text,
  notes text,
  has_recording boolean default false,
  recording_url text,
  created_at timestamptz default now()
);

-- ── Audit Log ─────────────────────────────────────────────────
create table if not exists audit_log (
  id uuid primary key default uuid_generate_v4(),
  message text not null,
  entity_type text,
  entity_id uuid,
  created_at timestamptz default now()
);

-- ── Outreach Campaigns ────────────────────────────────────────
create table if not exists campaigns (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  type text default 'sms',
  status text default 'draft',
  message_template text,
  target_filter jsonb,
  scheduled_at timestamptz,
  sent_count integer default 0,
  created_at timestamptz default now()
);

-- ── Real-time: enable replication on all tables ───────────────
alter publication supabase_realtime add table customers;
alter publication supabase_realtime add table jobs;
alter publication supabase_realtime add table documents;
alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table activities;
alter publication supabase_realtime add table settings;
alter publication supabase_realtime add table audit_log;

-- ── Indexes ───────────────────────────────────────────────────
create index if not exists idx_jobs_customer_id on jobs(customer_id);
create index if not exists idx_jobs_status on jobs(status);
create index if not exists idx_documents_customer_id on documents(customer_id);
create index if not exists idx_documents_type on documents(type);
create index if not exists idx_messages_customer_id on messages(customer_id);
create index if not exists idx_messages_created_at on messages(created_at desc);
create index if not exists idx_messages_read on messages(read);

-- ── RLS: disable for now (enable + add policies when you add auth) ──
alter table settings disable row level security;
alter table customers disable row level security;
alter table jobs disable row level security;
alter table documents disable row level security;
alter table messages disable row level security;
alter table activities disable row level security;
alter table audit_log disable row level security;
alter table campaigns disable row level security;

-- ── Connectors (Social Media & Calendar OAuth) ────────────────
create table if not exists connectors (
  id uuid primary key default gen_random_uuid(),
  service text not null unique,
  enabled boolean default false,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  page_id text,
  page_access_token text,
  metadata jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table connectors disable row level security;

-- Seed initial rows
insert into connectors (service, enabled) values
  ('facebook', false),
  ('instagram', false),
  ('google_business', false),
  ('google_calendar', false)
on conflict (service) do nothing;

alter publication supabase_realtime add table connectors;
