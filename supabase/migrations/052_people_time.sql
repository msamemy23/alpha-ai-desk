-- Time clock: pay-week and overtime rules, time on a job, timesheet approval, a change history, pay rates and kiosk PINs.
--
-- Every table here is only reached through the server (the /api/timeclock and /api/staff routes), so the browser gets no
-- access: row level security is on, the tables are revoked from everyone except the service role, and every query the app
-- runs is filtered by shop_id.
--
-- The app checks for these tables and columns: until this runs, the Team screen works as it does today and each new
-- feature shows a short "needs a database update" note. Needs 035_timeclock_breaks.sql for breaks. Safe to run more than once.
-- Not applied to production yet.

-- How the shop pays: which day the pay week starts, one-week or two-week periods, and when overtime begins.
create table if not exists public.time_rules (
  shop_id uuid primary key references public.shop_profiles(id) on delete cascade,
  week_start smallint not null default 1 check (week_start between 0 and 6),
  period_days smallint not null default 7 check (period_days in (7, 14)),
  period_anchor date,
  weekly_ot_min integer default 2400 check (weekly_ot_min is null or weekly_ot_min between 60 and 10080),
  daily_ot_min integer check (daily_ot_min is null or daily_ot_min between 60 and 1440),
  daily_double_min integer check (daily_double_min is null or daily_double_min between 60 and 1440),
  state text check (state is null or state ~ '^[A-Z]{2}$'),
  location_mode text not null default 'off' check (location_mode in ('off', 'record', 'require')),
  geofence_lat double precision check (geofence_lat is null or geofence_lat between -90 and 90),
  geofence_lng double precision check (geofence_lng is null or geofence_lng between -180 and 180),
  geofence_radius_m integer check (geofence_radius_m is null or geofence_radius_m between 30 and 5000),
  require_pin boolean not null default true,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.time_rules enable row level security;
revoke all on table public.time_rules from public, anon, authenticated;
grant all on table public.time_rules to service_role;

-- Where a punch was made, when the shop turns the location check on. Only inside, outside or unknown and the distance are
-- kept, never the coordinates of the person.
alter table public.timeclock add column if not exists in_location text;
alter table public.timeclock add column if not exists in_distance_m integer;
alter table public.timeclock add column if not exists punch_source text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'timeclock_in_location_check' and conrelid = 'public.timeclock'::regclass) then
    alter table public.timeclock add constraint timeclock_in_location_check check (in_location is null or in_location in ('inside', 'outside', 'unknown'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'timeclock_punch_source_check' and conrelid = 'public.timeclock'::regclass) then
    alter table public.timeclock add constraint timeclock_punch_source_check check (punch_source is null or punch_source in ('app', 'kiosk'));
  end if;
end $$;

-- Time on a job: one row each time a technician starts working on a repair order. At most one running job per person.
create table if not exists public.job_time (
  id bigint generated always as identity primary key,
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  staff_id bigint,
  staff_name text not null check (length(staff_name) between 1 and 200),
  entry_id bigint,
  job_id text not null check (length(job_id) between 1 and 80),
  job_label text not null default '' check (length(job_label) <= 300),
  started_at timestamptz not null,
  ended_at timestamptz,
  note text check (note is null or length(note) <= 500),
  created_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);
create unique index if not exists job_time_one_running_per_person on public.job_time (shop_id, staff_id) where ended_at is null and staff_id is not null;
create index if not exists job_time_shop_started on public.job_time (shop_id, started_at desc);
create index if not exists job_time_shop_job on public.job_time (shop_id, job_id);
alter table public.job_time enable row level security;
revoke all on table public.job_time from public, anon, authenticated;
grant all on table public.job_time to service_role;

-- A manager signing off one person's hours for one pay period.
create table if not exists public.time_approvals (
  id bigint generated always as identity primary key,
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  staff_id bigint not null,
  period_start date not null,
  period_days smallint not null default 7 check (period_days in (7, 14)),
  -- The same period as exact instants, cut at the shop's local midnight by the browser that approved it. Punches that start
  -- inside this window are locked until the approval is removed.
  window_from timestamptz not null,
  window_to timestamptz not null,
  minutes_total integer not null check (minutes_total >= 0),
  approved_by uuid,
  approved_at timestamptz not null default now(),
  note text check (note is null or length(note) <= 500),
  unique (shop_id, staff_id, period_start),
  check (window_to > window_from)
);
create index if not exists time_approvals_shop_period on public.time_approvals (shop_id, period_start desc);
alter table public.time_approvals enable row level security;
revoke all on table public.time_approvals from public, anon, authenticated;
grant all on table public.time_approvals to service_role;

-- Every change to a punch: what it was before, what it is now and why. A deleted punch can be put back from here.
create table if not exists public.time_entry_changes (
  id bigint generated always as identity primary key,
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  entry_id bigint not null,
  staff_id bigint,
  staff_name text,
  action text not null check (action in ('add', 'edit', 'delete', 'undo_clock_out', 'restore')),
  before_row jsonb,
  after_row jsonb,
  reason text check (reason is null or length(reason) <= 500),
  changed_by uuid,
  changed_at timestamptz not null default now()
);
create index if not exists time_entry_changes_shop_when on public.time_entry_changes (shop_id, changed_at desc);
create index if not exists time_entry_changes_shop_staff on public.time_entry_changes (shop_id, staff_id, changed_at desc);
alter table public.time_entry_changes enable row level security;
revoke all on table public.time_entry_changes from public, anon, authenticated;
grant all on table public.time_entry_changes to service_role;

-- What a person is paid, for the owner's planning and for cost on a job. Readable by the owner and admins only.
create table if not exists public.staff_pay (
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  staff_id bigint not null,
  method text not null default 'hourly' check (method in ('hourly', 'flat', 'commission')),
  hourly_rate numeric(8, 2) check (hourly_rate is null or hourly_rate between 0 and 1000),
  flat_rate numeric(8, 2) check (flat_rate is null or flat_rate between 0 and 1000),
  commission_pct numeric(5, 2) check (commission_pct is null or commission_pct between 0 and 100),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (shop_id, staff_id)
);
alter table public.staff_pay enable row level security;
revoke all on table public.staff_pay from public, anon, authenticated;
grant all on table public.staff_pay to service_role;

-- PINs for the shared clock-in tablet. Only a salted hash is stored. Five wrong tries lock the PIN for five minutes.
create table if not exists public.staff_pins (
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  staff_id bigint not null,
  pin_hash text not null check (length(pin_hash) between 20 and 300),
  failed_count integer not null default 0 check (failed_count >= 0),
  locked_until timestamptz,
  set_by uuid,
  updated_at timestamptz not null default now(),
  primary key (shop_id, staff_id)
);
alter table public.staff_pins enable row level security;
revoke all on table public.staff_pins from public, anon, authenticated;
grant all on table public.staff_pins to service_role;
