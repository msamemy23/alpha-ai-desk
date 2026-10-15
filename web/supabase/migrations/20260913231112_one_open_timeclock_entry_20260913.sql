-- The route performs a friendly preflight read, but this index is the
-- authoritative protection against simultaneous clock-in requests.
create unique index if not exists timeclock_one_open_entry_per_staff
  on public.timeclock (shop_id, staff_id)
  where clock_out is null and staff_id is not null;
