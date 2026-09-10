-- Keep call identity tenant-scoped and normalize legacy nullable payment amounts.
-- Unmatched legacy call rows remain quarantined (shop_id NULL) until their owner
-- can be established safely; new writes always include a shop_id.
update public.call_history ch
set shop_id = c.shop_id
from public.customers c
where ch.shop_id is null
  and ch.customer_id = c.id
  and c.shop_id is not null;

alter table public.call_history
  drop constraint if exists call_history_call_id_key;

alter table public.call_history
  add constraint call_history_shop_id_call_id_key unique (shop_id, call_id);

update public.documents
set amount_paid = 0
where amount_paid is null;

alter table public.documents
  alter column amount_paid set default 0;
