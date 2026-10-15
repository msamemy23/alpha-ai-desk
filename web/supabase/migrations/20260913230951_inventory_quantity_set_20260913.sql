-- Absolute quantity edits need compare-and-set semantics. The browser and AI
-- both see a snapshot; never overwrite a newer stock count silently.
alter table if exists public.inventory_adjustments
  add column if not exists expected_qty_on_hand integer;
alter table if exists public.inventory_adjustments
  add column if not exists target_qty_on_hand integer;

create or replace function public.set_inventory_quantity_server(
  p_user_id uuid,
  p_shop_id uuid,
  p_inventory_id uuid,
  p_target_qty integer,
  p_expected_qty integer,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_adjustment_id uuid;
  v_quantity integer;
  v_existing_qty integer;
  v_delta integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if p_user_id is null or p_shop_id is null or p_inventory_id is null
     or p_target_qty is null or p_expected_qty is null
     or p_target_qty < 0 or p_expected_qty < 0
     or length(coalesce(p_idempotency_key, '')) = 0
     or length(p_idempotency_key) > 160 then
    raise exception 'Inventory quantity identity is invalid' using errcode = '22023';
  end if;

  v_delta := p_target_qty - p_expected_qty;
  if v_delta = 0 or abs(v_delta) > 100000 then
    raise exception 'Inventory quantity change is invalid' using errcode = '22023';
  end if;

  insert into public.inventory_adjustments
    (shop_id, inventory_id, delta, idempotency_key, created_by, expected_qty_on_hand, target_qty_on_hand)
  values
    (p_shop_id, p_inventory_id, v_delta, p_idempotency_key, p_user_id, p_expected_qty, p_target_qty)
  on conflict (shop_id, idempotency_key) do nothing
  returning id into v_adjustment_id;

  if v_adjustment_id is null then
    select result_qty_on_hand into v_existing_qty
      from public.inventory_adjustments
     where shop_id = p_shop_id
       and idempotency_key = p_idempotency_key;
    if v_existing_qty is null then
      raise exception 'Inventory quantity change is still being reconciled' using errcode = '55P03';
    end if;
    return jsonb_build_object('idempotent', true, 'inventory_id', p_inventory_id, 'qty_on_hand', v_existing_qty);
  end if;

  update public.inventory
     set qty_on_hand = p_target_qty,
         updated_at = now()
   where id = p_inventory_id
     and shop_id = p_shop_id
     and coalesce(qty_on_hand, 0) = p_expected_qty
  returning qty_on_hand into v_quantity;

  if not found then
    raise exception 'Inventory changed since it was read; refresh before setting an absolute quantity' using errcode = '40001';
  end if;

  update public.inventory_adjustments
     set result_qty_on_hand = v_quantity
   where id = v_adjustment_id;

  return jsonb_build_object('idempotent', false, 'inventory_id', p_inventory_id, 'qty_on_hand', v_quantity);
end;
$$;

revoke all on function public.set_inventory_quantity_server(uuid, uuid, uuid, integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.set_inventory_quantity_server(uuid, uuid, uuid, integer, integer, text)
  to service_role;
