-- Vehicles: a saved record for a car (added by hand, or created the first time a note, mileage reading or photo is saved), a
-- mileage log, and photos.
--
-- The Vehicles screen still builds its list from customers and repair orders, as it does today. A record here is matched to
-- a car by VIN, or by owner plus year, make and model, so nothing about customers or repair orders changes. Every table is only
-- reached through the server (the /api/vehicles routes): row level security is on, the tables are revoked from everyone
-- except the service role, and every query the app runs is filtered by shop_id.
--
-- The app checks for these tables: until this runs, the Vehicles screen works as it does today and each new feature shows a
-- short "needs a database update" note. Safe to run more than once. Not applied to production yet.

create table if not exists public.vehicle_records (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  customer_id uuid,
  year text check (year is null or length(year) <= 4),
  make text check (make is null or length(make) <= 80),
  model text check (model is null or length(model) <= 120),
  trim_level text check (trim_level is null or length(trim_level) <= 120),
  vin text check (vin is null or length(vin) <= 17),
  plate text check (plate is null or length(plate) <= 12),
  plate_state text check (plate_state is null or length(plate_state) <= 2),
  color text check (color is null or length(color) <= 40),
  engine text check (engine is null or length(engine) <= 160),
  body text check (body is null or length(body) <= 120),
  drive text check (drive is null or length(drive) <= 80),
  fuel text check (fuel is null or length(fuel) <= 80),
  transmission text check (transmission is null or length(transmission) <= 120),
  notes text check (notes is null or length(notes) <= 4000),
  source text not null default 'manual' check (source in ('manual', 'decoded', 'scan', 'merge', 'auto')),
  decoded_at timestamptz,
  recalls jsonb,
  recalls_checked_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index if not exists vehicle_records_shop_customer on public.vehicle_records (shop_id, customer_id);
create index if not exists vehicle_records_shop_vin on public.vehicle_records (shop_id, vin) where vin is not null and vin <> '';
create unique index if not exists vehicle_records_one_vin_per_customer on public.vehicle_records (shop_id, customer_id, vin) where vin is not null and vin <> '' and archived_at is null;
alter table public.vehicle_records enable row level security;
revoke all on table public.vehicle_records from public, anon, authenticated;
grant all on table public.vehicle_records to service_role;

-- Odometer readings the shop logged by hand. Readings on repair orders are read from the repair orders themselves.
create table if not exists public.vehicle_mileage_log (
  id bigint generated always as identity primary key,
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  record_id uuid not null,
  miles integer not null check (miles between 1 and 2000000),
  read_at timestamptz not null default now(),
  note text check (note is null or length(note) <= 300),
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists vehicle_mileage_log_shop_record on public.vehicle_mileage_log (shop_id, record_id, read_at desc);
alter table public.vehicle_mileage_log enable row level security;
revoke all on table public.vehicle_mileage_log from public, anon, authenticated;
grant all on table public.vehicle_mileage_log to service_role;

-- Pictures of a car. The browser shrinks each one first (about 1280 pixels wide, a few hundred KB at most) and makes a small
-- thumbnail, and the server stores both as data URLs, the same way the shop logo is kept. Eight per car.
create table if not exists public.vehicle_photos (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  record_id uuid not null,
  caption text check (caption is null or length(caption) <= 200),
  thumb_data text not null check (length(thumb_data) <= 80000 and thumb_data ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$'),
  image_data text not null check (length(image_data) <= 500000 and image_data ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$'),
  created_by uuid,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create index if not exists vehicle_photos_shop_record on public.vehicle_photos (shop_id, record_id, created_at desc);
alter table public.vehicle_photos enable row level security;
revoke all on table public.vehicle_photos from public, anon, authenticated;
grant all on table public.vehicle_photos to service_role;
