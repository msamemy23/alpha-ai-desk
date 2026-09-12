-- Credentials are encrypted by the application and never exposed through RLS.
create table public.private_chatgpt_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  revision uuid not null,
  encrypted_state text not null,
  expires_at timestamptz not null,
  next_poll_at timestamptz not null default now()
);
alter table public.private_chatgpt_connections enable row level security;
revoke all on public.private_chatgpt_connections from public, anon, authenticated;
grant select, insert, update, delete on public.private_chatgpt_connections to service_role;
comment on table public.private_chatgpt_connections is 'Server-only encrypted per-user ChatGPT connection; never shop-shared.';
