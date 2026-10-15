-- Shop board: parts status, labels, estimated hours, the promised time, and a status link the customer can follow.
--
-- Safe to run more than once. Nothing here changes the jobs table or any existing row: the extras live in their own table.
-- The app keeps working without it: the board shows what it always showed, and the new fields show a short notice.
-- Not applied to production yet.

create table if not exists public.job_flow (
  job_id uuid primary key,
  shop_id uuid not null,
  parts text not null default 'none',
  parts_note text not null default '',
  parts_eta date,
  labels jsonb not null default '[]'::jsonb,
  est_hours numeric(5, 2),
  promise_time text,
  public_note text not null default '',
  status_token text,
  ready_text_at timestamptz,
  -- Bumped on every save. A save made from an older copy is refused, so two people cannot silently overwrite each other.
  version integer not null default 1,
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'job_flow_parts_check' and conrelid = 'public.job_flow'::regclass) then
    alter table public.job_flow add constraint job_flow_parts_check check (parts in ('none', 'needed', 'ordered', 'partial', 'in'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'job_flow_hours_check' and conrelid = 'public.job_flow'::regclass) then
    alter table public.job_flow add constraint job_flow_hours_check check (est_hours is null or (est_hours > 0 and est_hours <= 99));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'job_flow_time_check' and conrelid = 'public.job_flow'::regclass) then
    alter table public.job_flow add constraint job_flow_time_check check (promise_time is null or promise_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'job_flow_labels_check' and conrelid = 'public.job_flow'::regclass) then
    alter table public.job_flow add constraint job_flow_labels_check check (jsonb_typeof(labels) = 'array' and jsonb_array_length(labels) <= 5);
  end if;
end $$;

-- A customer's status link is looked up by its token alone, so tokens are unique. Most cars have none.
create unique index if not exists idx_job_flow_token on public.job_flow (status_token) where status_token is not null;
create index if not exists idx_job_flow_shop on public.job_flow (shop_id);

-- A row can only describe a job of the same shop.
create or replace function public.job_flow_same_shop()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (select 1 from public.jobs j where j.id = new.job_id and j.shop_id = new.shop_id) then
    raise exception 'job_flow row does not belong to a job of this shop' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_job_flow_same_shop on public.job_flow;
create trigger trg_job_flow_same_shop
  before insert on public.job_flow
  for each row execute function public.job_flow_same_shop();

revoke all on function public.job_flow_same_shop() from public, anon, authenticated;

alter table public.job_flow enable row level security;
revoke all on table public.job_flow from public, anon, authenticated;
grant all on table public.job_flow to service_role;
