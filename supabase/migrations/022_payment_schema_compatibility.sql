-- Keep payment RPCs compatible with legacy deployments that used either note or notes.
alter table public.payments add column if not exists customer_id uuid;
alter table public.payments add column if not exists note text;
alter table public.payments add column if not exists notes text;

update public.payments
   set note = coalesce(note, notes)
 where note is null
   and notes is not null;
