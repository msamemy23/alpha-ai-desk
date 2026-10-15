-- A signature request creates a bearer token and an outbound email. Bind both
-- effects to one caller-owned request key so retries cannot duplicate them.
alter table if exists public.signatures
  add column if not exists idempotency_key text;

create unique index if not exists signatures_shop_idempotency_key_uq
  on public.signatures (shop_id, idempotency_key)
  where idempotency_key is not null;
