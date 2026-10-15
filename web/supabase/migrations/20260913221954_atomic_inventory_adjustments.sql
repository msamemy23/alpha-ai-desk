-- Inventory +/- buttons must be atomic. The browser's displayed quantity is
-- only a snapshot and cannot be used to calculate the next quantity safely.
create table if not exists public.inventory_adjustments (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  inventory_id uuid not null references public.inventory(id) on delete cascade,
  delta integer not null check (delta <> 0 and abs(delta) <= 100000),
  idempotency_key text not null,
  created_by uuid null,
  result_qty_on_hand integer null,
  created_at timestamptz not null default now()
);

create unique index if not exists inventory_adjustments_shop_key_uq
  on public.inventory_adjustments (shop_id, idempotency_key);

create index if not exists inventory_adjustments_inventory_idx
  on public.inventory_adjustments (shop_id, inventory_id, created_at desc);

alter table public.inventory_adjustments enable row level security;
drop policy if exists inventory_adjustments_service_role_only on public.inventory_adjustments;
create policy inventory_adjustments_service_role_only
  on public.inventory_adjustments for all to service_role
  using (true) with check (true);
revoke all on public.inventory_adjustments from public, anon, authenticated;

create or replace function public.adjust_inventory_quantity_server(
  p_user_id uuid,
  p_shop_id uuid,
  p_inventory_id uuid,
  p_delta integer,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_adjustment_id uuid;
  v_inventory_id uuid;
  v_quantity integer;
  v_existing_qty integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if p_user_id is null or p_shop_id is null or p_inventory_id is null
     or p_delta is null or p_delta = 0
     or abs(p_delta) > 100000
     or nullif(btrim(coalesce(p_idempotency_key, '')), '') is null
     or length(p_idempotency_key) > 160 then
    raise exception 'Inventory adjustment identity is invalid' using errcode = '22023';
  end if;

  -- Claim the adjustment before changing stock. A concurrent retry waits on
  -- the unique key and then returns the first transaction's result.
  insert into public.inventory_adjustments
    (shop_id, inventory_id, delta, idempotency_key, created_by)
  values
    (p_shop_id, p_inventory_id, p_delta, p_idempotency_key, p_user_id)
  on conflict (shop_id, idempotency_key) do nothing
  returning id into v_adjustment_id;

  if v_adjustment_id is null then
    select result_qty_on_hand into v_existing_qty
      from public.inventory_adjustments
     where shop_id = p_shop_id
       and idempotency_key = p_idempotency_key;
    if v_existing_qty is null then
      raise exception 'Inventory adjustment is still being reconciled' using errcode = '55P03';
    end if;
    return jsonb_build_object(
      'idempotent', true,
      'inventory_id', p_inventory_id,
      'qty_on_hand', v_existing_qty
    );
  end if;

  update public.inventory
     set qty_on_hand = greatest(0, coalesce(qty_on_hand, 0) + p_delta),
         updated_at = now()
   where id = p_inventory_id
     and shop_id = p_shop_id
  returning id, qty_on_hand into v_inventory_id, v_quantity;

  if not found then
    raise exception 'Inventory item not found for this shop' using errcode = 'P0002';
  end if;

  update public.inventory_adjustments
     set result_qty_on_hand = v_quantity
   where id = v_adjustment_id;

  return jsonb_build_object(
    'idempotent', false,
    'inventory_id', v_inventory_id,
    'qty_on_hand', v_quantity
  );
end;
$$;

revoke all on function public.adjust_inventory_quantity_server(uuid, uuid, uuid, integer, text)
  from public, anon, authenticated;
grant execute on function public.adjust_inventory_quantity_server(uuid, uuid, uuid, integer, text)
  to service_role;
