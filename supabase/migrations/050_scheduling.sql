-- Scheduling: capacity, online booking, a calendar feed, and the extra facts a booking carries.
--
-- Safe to run more than once. Nothing here changes existing rows.
-- The app checks for each piece and keeps working without it:
--   * no schedule_settings table: the Schedule screen uses its built-in hours and service times and shows a notice
--     in Settings; online booking and the calendar feed stay off.
--   * no kind/bay/source columns on appointments: bookings save as before; "waiting or drop-off" and "bay" are hidden.
-- Not applied to production yet.

-- 1. One row per shop. Only the server reads or writes it: the public booking page sees a cut-down copy.
create table if not exists public.schedule_settings (
  shop_id uuid primary key,
  capacity jsonb not null default '{}'::jsonb,
  online jsonb not null default '{}'::jsonb,
  board jsonb not null default '{}'::jsonb,
  ical_token text,
  updated_at timestamptz not null default now()
);

-- A shop's booking page is found by its address alone, so addresses are unique. Most shops have none.
create unique index if not exists idx_schedule_settings_slug on public.schedule_settings ((online ->> 'slug'))
  where coalesce(online ->> 'slug', '') <> '';
create unique index if not exists idx_schedule_settings_ical on public.schedule_settings (ical_token) where ical_token is not null;

alter table public.schedule_settings enable row level security;
revoke all on table public.schedule_settings from public, anon, authenticated;
grant all on table public.schedule_settings to service_role;

-- 2. What a booking carries beyond the time and the customer.
alter table public.appointments add column if not exists kind text;
alter table public.appointments add column if not exists bay text;
alter table public.appointments add column if not exists source text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'appointments_kind_check' and conrelid = 'public.appointments'::regclass) then
    alter table public.appointments add constraint appointments_kind_check check (kind is null or kind in ('dropoff', 'wait'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'appointments_source_check' and conrelid = 'public.appointments'::regclass) then
    alter table public.appointments add constraint appointments_source_check check (source is null or source in ('shop', 'online', 'phone', 'walk-in'));
  end if;
end $$;

-- Looking up a phone number's earlier bookings (no-shows, requests waiting) is part of every online request.
create index if not exists idx_appointments_shop_phone on public.appointments (shop_id, phone);

-- 3. A short-lived tally for public pages, so a flood is counted across every server, not just one.
-- The key is a one-way hash; no address or phone number is stored. Old rows for a key are cleared when that key is next used.
create table if not exists public.public_rate_hits (
  id bigserial primary key,
  scope text not null,
  key_hash text not null,
  hit_at timestamptz not null default now()
);
create index if not exists idx_public_rate_hits_key on public.public_rate_hits (scope, key_hash, hit_at desc);

alter table public.public_rate_hits enable row level security;
revoke all on table public.public_rate_hits from public, anon, authenticated;
grant all on table public.public_rate_hits to service_role;
grant usage, select on sequence public.public_rate_hits_id_seq to service_role;
