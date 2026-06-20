-- Repair Workspace v3 tables
-- Source pages remain external. These tables store shop-owned notes,
-- verification metadata, source links, and generated repair research sessions.

create table if not exists public.repair_procedure_cards (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  title text not null,
  status text not null default 'draft' check (status in ('draft', 'verified', 'retired')),
  confidence text not null default 'needs_review' check (confidence in ('needs_review', 'source_linked', 'shop_verified')),
  vehicle_year text,
  vehicle_make text,
  vehicle_model text,
  vehicle_engine text,
  vehicle_trim text,
  vehicle_drivetrain text,
  vehicle_transmission text,
  vehicle_brake_system text,
  operation text not null,
  systems text[] default '{}',
  tools text[] default '{}',
  parts_fluids text[] default '{}',
  safety_gates jsonb default '[]'::jsonb,
  operation_lines jsonb default '[]'::jsonb,
  source_links jsonb default '[]'::jsonb,
  technician_notes text default '',
  approved_by text,
  approved_at timestamptz,
  version integer not null default 1,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.repair_research_sessions (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  user_id uuid,
  query text not null,
  normalized_vehicle jsonb default '{}'::jsonb,
  coverage jsonb default '{}'::jsonb,
  operation_lines jsonb default '[]'::jsonb,
  safety_profile jsonb default '{}'::jsonb,
  estimate_draft jsonb default '{}'::jsonb,
  source_links jsonb default '[]'::jsonb,
  manual_matches jsonb default '[]'::jsonb,
  warnings text[] default '{}',
  created_at timestamptz not null default now()
);

create index if not exists idx_repair_procedure_cards_shop_vehicle
  on public.repair_procedure_cards(shop_id, vehicle_year, vehicle_make, vehicle_model);

create index if not exists idx_repair_procedure_cards_shop_operation
  on public.repair_procedure_cards using gin (to_tsvector('simple', coalesce(operation, '') || ' ' || coalesce(title, '') || ' ' || coalesce(technician_notes, '')));

create index if not exists idx_repair_research_sessions_shop_created
  on public.repair_research_sessions(shop_id, created_at desc);

alter table public.repair_procedure_cards enable row level security;
alter table public.repair_research_sessions enable row level security;

drop policy if exists "repair_procedure_cards_shop_select" on public.repair_procedure_cards;
create policy "repair_procedure_cards_shop_select" on public.repair_procedure_cards
  for select using (shop_id in (select id from public.shop_profiles where user_id = auth.uid()));

drop policy if exists "repair_procedure_cards_shop_insert" on public.repair_procedure_cards;
create policy "repair_procedure_cards_shop_insert" on public.repair_procedure_cards
  for insert with check (shop_id in (select id from public.shop_profiles where user_id = auth.uid()));

drop policy if exists "repair_procedure_cards_shop_update" on public.repair_procedure_cards;
create policy "repair_procedure_cards_shop_update" on public.repair_procedure_cards
  for update using (shop_id in (select id from public.shop_profiles where user_id = auth.uid()))
  with check (shop_id in (select id from public.shop_profiles where user_id = auth.uid()));

drop policy if exists "repair_research_sessions_shop_select" on public.repair_research_sessions;
create policy "repair_research_sessions_shop_select" on public.repair_research_sessions
  for select using (shop_id in (select id from public.shop_profiles where user_id = auth.uid()));

drop policy if exists "repair_research_sessions_shop_insert" on public.repair_research_sessions;
create policy "repair_research_sessions_shop_insert" on public.repair_research_sessions
  for insert with check (shop_id in (select id from public.shop_profiles where user_id = auth.uid()));
