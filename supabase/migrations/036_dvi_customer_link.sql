-- Digital vehicle inspections: a private link for the customer, their answers, and a real link to the customer.
-- Safe to run more than once. Nothing here changes existing rows. The app keeps working without it:
-- until it is applied, inspections are still saved and texted, but without the link and the approve/decline page.
alter table public.dvi add column if not exists customer_id uuid references public.customers(id) on delete set null;
alter table public.dvi add column if not exists share_token text;
alter table public.dvi add column if not exists customer_decisions jsonb not null default '{}'::jsonb;
alter table public.dvi add column if not exists customer_decided_at timestamptz;
alter table public.dvi add column if not exists viewed_at timestamptz;
-- Counts kept by the app on every save, so the list can show "3 need work, 2 to watch" without loading every photo.
alter table public.dvi add column if not exists summary jsonb not null default '{}'::jsonb;

-- A customer link is looked up by token alone, so tokens are unique. Many rows have none.
create unique index if not exists idx_dvi_share_token on public.dvi (share_token) where share_token is not null;
create index if not exists idx_dvi_shop_created on public.dvi (shop_id, created_at desc);
create index if not exists idx_dvi_job on public.dvi (job_id) where job_id is not null;
