-- Estimates and invoices, part 2: paperwork settings, good-better-best options, whole-document templates,
-- canned job extras, and declined work kept for later.
--
--   document_settings   one row per shop: how long estimates stay good, terms, accent color, markup matrix, labor rates,
--                       shop supplies rule, fee presets, the shop's own warranty wording, the text message wording.
--                       Stored as one JSON document that the app checks before it saves (src/lib/doc-prefs.ts).
--   document_options    "Good, better, best" choices attached to an estimate. The customer picks one; its lines are then
--                       added to the document. Nothing here is counted in a document's total until it is chosen.
--   document_templates  a whole estimate or invoice saved to start the next one from.
--   canned_job_extras   per canned job: keywords, which vehicles it fits, per-vehicle variants, fees, a note for the
--                       customer. Kept apart from canned_jobs so the existing table is not changed.
--   declined_work       jobs a customer said no to, kept so the shop can follow up and make a new estimate from them.
--
-- Server only, like migration 046: RLS on, only the service role has any grant, every row carries the shop id.
-- Safe to run more than once. Not applied to production yet; each feature shows a "needs a database update" note until it is.

create table if not exists public.document_settings (
  shop_id uuid primary key references public.shop_profiles(id) on delete cascade,
  data jsonb not null default '{}'::jsonb check (length(data::text) <= 60000),
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.document_settings enable row level security;
revoke all on table public.document_settings from public, anon, authenticated;
grant all on table public.document_settings to service_role;

create table if not exists public.document_options (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  document_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 80),
  position integer not null default 0,
  -- [{ id, label, description, recommended, parts: [...], labors: [...] }]
  choices jsonb not null default '[]'::jsonb check (length(choices::text) <= 100000),
  status text not null default 'open' check (status in ('open', 'chosen', 'declined', 'void')),
  chosen_choice_id text,
  decided_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_document_options_document on public.document_options (shop_id, document_id, position);

alter table public.document_options enable row level security;
revoke all on table public.document_options from public, anon, authenticated;
grant all on table public.document_options to service_role;

create table if not exists public.document_templates (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  description text not null default '' check (length(description) <= 400),
  kind text not null default 'any' check (kind in ('any', 'estimate', 'invoice')),
  parts jsonb not null default '[]'::jsonb,
  labors jsonb not null default '[]'::jsonb,
  shop_supplies numeric not null default 0 check (shop_supplies >= 0),
  notes text not null default '' check (length(notes) <= 4000),
  warranty_type text not null default '' check (length(warranty_type) <= 120),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(parts::text) + length(labors::text) <= 200000)
);

create index if not exists idx_document_templates_shop on public.document_templates (shop_id, name);

alter table public.document_templates enable row level security;
revoke all on table public.document_templates from public, anon, authenticated;
grant all on table public.document_templates to service_role;

-- canned_jobs has no migration of its own in this repository, so its id is kept as text here rather than as a foreign key.
create table if not exists public.canned_job_extras (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  canned_job_id text not null check (length(canned_job_id) between 1 and 64),
  data jsonb not null default '{}'::jsonb check (length(data::text) <= 60000),
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_canned_job_extras_job on public.canned_job_extras (shop_id, canned_job_id);

alter table public.canned_job_extras enable row level security;
revoke all on table public.canned_job_extras from public, anon, authenticated;
grant all on table public.canned_job_extras to service_role;

create table if not exists public.declined_work (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  document_id uuid,
  customer_id uuid,
  customer_name text,
  vehicle text,
  job text not null check (length(job) between 1 and 120),
  amount numeric not null default 0 check (amount >= 0),
  lines jsonb not null default '[]'::jsonb check (length(lines::text) <= 40000),
  source text not null default 'estimate' check (source in ('estimate', 'inspection', 'manual')),
  status text not null default 'open' check (status in ('open', 'reminded', 'booked', 'dismissed')),
  declined_at timestamptz not null default now(),
  remind_after date,
  note text check (note is null or length(note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_declined_work_shop_open on public.declined_work (shop_id, status, declined_at desc);
create index if not exists idx_declined_work_customer on public.declined_work (shop_id, customer_id) where customer_id is not null;
-- One row per job per estimate, so a repeated answer can never list the same declined job twice.
create unique index if not exists idx_declined_work_once on public.declined_work (shop_id, document_id, job) where document_id is not null and source = 'estimate';

alter table public.declined_work enable row level security;
revoke all on table public.declined_work from public, anon, authenticated;
grant all on table public.declined_work to service_role;
