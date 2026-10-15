-- Breaks on the time clock.
--
-- break_minutes is the total time taken off the clock for finished breaks. break_started_at is set while a
-- break is running and cleared when it ends. hours_worked (already stored when someone clocks out) becomes
-- time between the punches minus break_minutes.
--
-- The app checks for these columns: until this runs, the Break buttons stay hidden and everything else works.
-- Safe to run more than once. Not applied to production yet.

alter table public.timeclock add column if not exists break_minutes integer not null default 0;
alter table public.timeclock add column if not exists break_started_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'timeclock_break_minutes_check' and conrelid = 'public.timeclock'::regclass
  ) then
    alter table public.timeclock add constraint timeclock_break_minutes_check check (break_minutes >= 0 and break_minutes <= 1440);
  end if;
end $$;

-- The Team and Shop board screens ask for a shop's punches by time range.
create index if not exists idx_timeclock_shop_clock_in on public.timeclock (shop_id, clock_in);
