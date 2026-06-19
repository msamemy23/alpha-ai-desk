create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  user_id uuid null,
  action text not null,
  target_type text null,
  target_id text null,
  permission text null,
  approved boolean null,
  idempotency_key text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_shop_created_idx
  on public.audit_logs (shop_id, created_at desc);

create index if not exists audit_logs_idempotency_idx
  on public.audit_logs (shop_id, idempotency_key)
  where idempotency_key is not null;

alter table public.audit_logs enable row level security;

drop policy if exists "audit logs scoped to own shop" on public.audit_logs;
create policy "audit logs scoped to own shop"
  on public.audit_logs
  for select
  using (
    exists (
      select 1
      from public.shop_profiles sp
      where sp.id = audit_logs.shop_id
        and sp.user_id = auth.uid()
    )
  );
