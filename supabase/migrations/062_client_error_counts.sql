-- Problems reported: a daily COUNT of screens that broke for someone signed in.
--
-- When a screen breaks, the browser sends a cleaned report to /api/client-errors (no names, numbers, email addresses or typed text; see
-- lib/client-errors.ts). Until now that only wrote one line to the server log. This keeps a count per shop per day so the owner can open
-- Settings, then "Problems reported", and see which screens broke and how often, and so the Today screen can say "3 screen problems were
-- reported in the last day".
--
-- One new table and one new function, reached only through the server: row level security is on, no policies exist, every grant is revoked
-- from everyone except the service role, and every query the app runs is filtered by shop_id. It holds only the screen's name (ids taken
-- out), the kind of error, the short reference, the cleaned message and a count. Nothing existing is changed: no table, column or policy.
--
-- record_client_error() adds one to the matching row, or makes it. A shop keeps at most p_max_rows distinct problems for one day (a loop
-- that throws all day cannot fill the table) and counts older than p_keep_days are removed when a new problem is first seen.
-- Until this runs, reports are still written to the log and the list says it needs a database update. Safe to run more than once.

create table if not exists public.client_error_counts (
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  day date not null,
  kind text not null check (kind in ('screen', 'script', 'promise', 'app', 'page')),
  path text not null default '' check (length(path) <= 120),
  reference text not null default '' check (length(reference) <= 40),
  message text not null default '' check (length(message) <= 300),
  count integer not null default 1 check (count >= 1),
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (shop_id, day, kind, path, reference, message)
);
create index if not exists client_error_counts_recent on public.client_error_counts (shop_id, last_seen desc);
alter table public.client_error_counts enable row level security;
revoke all on table public.client_error_counts from public, anon, authenticated;
grant all on table public.client_error_counts to service_role;

create or replace function public.record_client_error(
  p_shop uuid, p_day date, p_kind text, p_path text, p_reference text, p_message text, p_max_rows integer default 200, p_keep_days integer default 30
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  seen_today integer;
begin
  update public.client_error_counts
     set count = least(count + 1, 1000000), last_seen = now()
   where shop_id = p_shop and day = p_day and kind = p_kind and path = p_path and reference = p_reference and message = p_message;
  if found then
    return 'counted';
  end if;

  select count(*) into seen_today from public.client_error_counts where shop_id = p_shop and day = p_day;
  if seen_today >= greatest(p_max_rows, 1) then
    return 'capped';
  end if;

  insert into public.client_error_counts (shop_id, day, kind, path, reference, message)
  values (p_shop, p_day, p_kind, p_path, p_reference, p_message)
  on conflict (shop_id, day, kind, path, reference, message)
  do update set count = least(public.client_error_counts.count + 1, 1000000), last_seen = now();

  delete from public.client_error_counts where shop_id = p_shop and day < p_day - greatest(p_keep_days, 1);
  return 'recorded';
end;
$$;
revoke all on function public.record_client_error(uuid, date, text, text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.record_client_error(uuid, date, text, text, text, text, integer, integer) to service_role;
