-- Parts functions: the only things that change a part's count, cost or price on the shop's behalf, and the purchase order steps
-- that go with them. Each one does its whole job in one transaction: it locks the rows it touches, changes them, and writes the
-- history line, so two people (or two taps) can never leave a count half-changed or counted twice.
--
--  inventory_apply_delta  change a count by an amount (+2, -1) or set it to a number, and record who and why
--  inventory_set_prices   apply an approved list of new prices; skips any part whose price changed since the list was made
--  next_po_number         the next purchase order number for a shop, from a counter
--  po_save_draft          create or replace a draft purchase order and its lines
--  po_mark_sent           mark an order sent and add its quantities to "on order"
--  po_cancel              cancel an order and take what had not arrived back out of "on order"
--  receive_po_lines       check a delivery in: counts go up, "on order" goes down, cost updates by the method chosen; the
--                         receipt key makes a repeated request count once
--
-- Every function takes the shop id and filters by it, is restricted to the service role (the API routes), and runs with a fixed
-- search path. Nothing here deletes a part or an order.
--
-- Needs migrations 055 and 056 first. Safe to run more than once. Not applied to production yet.

create or replace function public.inventory_apply_delta(
  p_shop_id uuid,
  p_part_id uuid,
  p_field text,
  p_delta numeric,
  p_set numeric,
  p_actor_id uuid,
  p_actor_name text,
  p_reason text,
  p_reference text,
  p_note text,
  p_clamp boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old numeric;
  v_new numeric;
begin
  if p_field not in ('qty_on_hand', 'qty_on_order', 'qty_reorder') then
    raise exception 'That field cannot be changed here' using errcode = '22023';
  end if;
  if (p_delta is null) = (p_set is null) then
    raise exception 'Give either an amount to add or take, or a new count' using errcode = '22023';
  end if;

  perform 1 from public.inventory where id = p_part_id and shop_id = p_shop_id for update;
  if not found then
    raise exception 'That part was not found' using errcode = 'P0002';
  end if;
  execute format('select %I::numeric from public.inventory where id = $1 and shop_id = $2', p_field)
    into v_old using p_part_id, p_shop_id;

  v_new := case when p_set is not null then p_set else coalesce(v_old, 0) + p_delta end;
  if v_new <> trunc(v_new) then
    raise exception 'A count has to be a whole number' using errcode = '22023';
  end if;
  if p_clamp then
    v_new := greatest(0, v_new);
  elsif v_new < 0 and v_new < coalesce(v_old, 0) then
    raise exception 'That would take the count below zero' using errcode = '23514';
  end if;
  if v_new > 1000000 then
    raise exception 'That count is too large' using errcode = '23514';
  end if;

  if v_old is distinct from v_new then
    execute format('update public.inventory set %I = $1, updated_at = now() where id = $2 and shop_id = $3', p_field)
      using v_new::integer, p_part_id, p_shop_id;
    insert into public.part_history (shop_id, part_id, actor_id, actor_name, field, old_value, new_value, reason, reference, note)
    values (p_shop_id, p_part_id, p_actor_id, left(coalesce(p_actor_name, ''), 120), p_field, v_old, v_new,
            left(coalesce(p_reason, ''), 40), left(coalesce(p_reference, ''), 80), left(coalesce(p_note, ''), 300));
  end if;

  return jsonb_build_object('old', v_old, 'new', v_new, 'changed', v_old is distinct from v_new);
end;
$$;

create or replace function public.inventory_set_prices(
  p_shop_id uuid,
  p_changes jsonb,
  p_actor_id uuid,
  p_actor_name text,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  v_cur numeric;
  v_changed integer := 0;
  v_skipped integer := 0;
begin
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) = 0 or jsonb_array_length(p_changes) > 2000 then
    raise exception 'Send between 1 and 2000 price changes' using errcode = '22023';
  end if;
  for c in select * from jsonb_to_recordset(p_changes) as x(part_id uuid, from_price numeric, to_price numeric) loop
    if c.part_id is null or c.to_price is null or c.to_price < 0 or c.to_price > 1000000 then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    perform 1 from public.inventory where id = c.part_id and shop_id = p_shop_id for update;
    if not found then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    select retail_price::numeric into v_cur from public.inventory where id = c.part_id and shop_id = p_shop_id;
    -- Someone changed this price after the list was made: leave it alone.
    if c.from_price is distinct from v_cur and not (c.from_price is not null and v_cur is not null and round(c.from_price, 2) = round(v_cur, 2)) then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    if v_cur is not distinct from c.to_price then
      continue;
    end if;
    update public.inventory set retail_price = round(c.to_price, 2), updated_at = now() where id = c.part_id and shop_id = p_shop_id;
    insert into public.part_history (shop_id, part_id, actor_id, actor_name, field, old_value, new_value, reason, reference, note)
    values (p_shop_id, c.part_id, p_actor_id, left(coalesce(p_actor_name, ''), 120), 'retail_price', v_cur, round(c.to_price, 2),
            left(coalesce(p_reason, 'price rules'), 40), '', '');
    v_changed := v_changed + 1;
  end loop;
  return jsonb_build_object('changed', v_changed, 'skipped', v_skipped);
end;
$$;

create or replace function public.next_po_number(p_shop_id uuid) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
begin
  insert into public.po_counters (shop_id, next_number) values (p_shop_id, 2)
  on conflict (shop_id) do update set next_number = public.po_counters.next_number + 1, updated_at = now()
  returning next_number - 1 into v_next;
  return 'PO-' || case when v_next < 10000 then lpad(v_next::text, 4, '0') else v_next::text end;
end;
$$;

create or replace function public.po_save_draft(
  p_shop_id uuid,
  p_po_id uuid,
  p_vendor_id uuid,
  p_vendor_name text,
  p_notes text,
  p_expected_on date,
  p_lines jsonb,
  p_actor_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_number text;
  v_status text;
  v_pos integer := 0;
  l record;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 200 then
    raise exception 'An order needs between 1 and 200 lines' using errcode = '22023';
  end if;
  if p_vendor_id is not null then
    perform 1 from public.vendors where id = p_vendor_id and shop_id = p_shop_id;
    if not found then
      raise exception 'That vendor was not found' using errcode = 'P0002';
    end if;
  end if;

  if p_po_id is null then
    v_number := public.next_po_number(p_shop_id);
    insert into public.purchase_orders (shop_id, po_number, vendor_id, vendor_name, notes, expected_on, created_by, updated_by)
    values (p_shop_id, v_number, p_vendor_id, left(coalesce(p_vendor_name, ''), 120), nullif(left(coalesce(p_notes, ''), 1000), ''), p_expected_on, p_actor_id, p_actor_id)
    returning id into v_id;
  else
    select status, po_number into v_status, v_number from public.purchase_orders where id = p_po_id and shop_id = p_shop_id for update;
    if not found then
      raise exception 'That order was not found' using errcode = 'P0002';
    end if;
    if v_status <> 'draft' then
      raise exception 'Only a draft order can be changed' using errcode = 'P0001';
    end if;
    update public.purchase_orders
       set vendor_id = p_vendor_id, vendor_name = left(coalesce(p_vendor_name, ''), 120), notes = nullif(left(coalesce(p_notes, ''), 1000), ''),
           expected_on = p_expected_on, updated_by = p_actor_id, updated_at = now()
     where id = p_po_id and shop_id = p_shop_id;
    delete from public.purchase_order_lines where po_id = p_po_id and shop_id = p_shop_id;
    v_id := p_po_id;
  end if;

  for l in select * from jsonb_to_recordset(p_lines) as x(part_id uuid, description text, sku text, qty integer, unit_cost numeric, core_charge numeric) loop
    if l.part_id is not null then
      perform 1 from public.inventory where id = l.part_id and shop_id = p_shop_id;
      if not found then
        raise exception 'A part on this order is not in your inventory' using errcode = 'P0002';
      end if;
    end if;
    v_pos := v_pos + 1;
    insert into public.purchase_order_lines (shop_id, po_id, position, part_id, description, sku, qty, unit_cost, core_charge)
    values (p_shop_id, v_id, v_pos, l.part_id, left(l.description, 200), nullif(left(coalesce(l.sku, ''), 60), ''), l.qty, round(l.unit_cost, 2), round(coalesce(l.core_charge, 0), 2));
  end loop;

  return jsonb_build_object('id', v_id, 'po_number', v_number);
end;
$$;

create or replace function public.po_mark_sent(
  p_shop_id uuid,
  p_po_id uuid,
  p_sent_to text,
  p_via text,
  p_actor_id uuid,
  p_actor_name text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_number text;
  l record;
begin
  select status, po_number into v_status, v_number from public.purchase_orders where id = p_po_id and shop_id = p_shop_id for update;
  if not found then
    raise exception 'That order was not found' using errcode = 'P0002';
  end if;
  if v_status in ('sent', 'partial', 'received') then
    return jsonb_build_object('already', true, 'status', v_status);
  end if;
  if v_status = 'cancelled' then
    raise exception 'This order was cancelled' using errcode = 'P0001';
  end if;

  update public.purchase_orders
     set status = 'sent', sent_at = now(), sent_to = left(coalesce(p_sent_to, ''), 300),
         sent_via = case when p_via = 'email' then 'email' else 'manual' end,
         send_started_at = coalesce(send_started_at, now()), updated_by = p_actor_id, updated_at = now()
   where id = p_po_id and shop_id = p_shop_id;

  for l in select part_id, qty from public.purchase_order_lines where po_id = p_po_id and shop_id = p_shop_id and part_id is not null loop
    begin
      perform public.inventory_apply_delta(p_shop_id, l.part_id, 'qty_on_order', l.qty, null, p_actor_id, p_actor_name, 'ordered', v_number, '', true);
    exception when sqlstate 'P0002' then
      null; -- the part was removed from inventory after the order was drafted
    end;
  end loop;
  return jsonb_build_object('already', false, 'status', 'sent');
end;
$$;

create or replace function public.po_cancel(
  p_shop_id uuid,
  p_po_id uuid,
  p_actor_id uuid,
  p_actor_name text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_number text;
  l record;
begin
  select status, po_number into v_status, v_number from public.purchase_orders where id = p_po_id and shop_id = p_shop_id for update;
  if not found then
    raise exception 'That order was not found' using errcode = 'P0002';
  end if;
  if v_status = 'cancelled' then
    return jsonb_build_object('already', true, 'status', v_status);
  end if;
  if v_status = 'received' then
    raise exception 'This order was fully received, so it cannot be cancelled' using errcode = 'P0001';
  end if;

  if v_status in ('sent', 'partial') then
    for l in select part_id, greatest(0, qty - qty_received) as outstanding from public.purchase_order_lines
              where po_id = p_po_id and shop_id = p_shop_id and part_id is not null loop
      if l.outstanding > 0 then
        begin
          perform public.inventory_apply_delta(p_shop_id, l.part_id, 'qty_on_order', -l.outstanding, null, p_actor_id, p_actor_name, 'cancelled', v_number, '', true);
        exception when sqlstate 'P0002' then
          null;
        end;
      end if;
    end loop;
  end if;

  update public.purchase_orders set status = 'cancelled', cancelled_at = now(), updated_by = p_actor_id, updated_at = now()
   where id = p_po_id and shop_id = p_shop_id;
  return jsonb_build_object('already', false, 'status', 'cancelled');
end;
$$;

create or replace function public.receive_po_lines(
  p_shop_id uuid,
  p_po_id uuid,
  p_receipt_key text,
  p_items jsonb,
  p_allow_over boolean,
  p_cost_method text,
  p_actor_id uuid,
  p_actor_name text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_number text;
  v_prior jsonb;
  v_done jsonb := '[]'::jsonb;
  v_missing jsonb := '[]'::jsonb;
  it record;
  ln record;
  pt record;
  v_had integer;
  v_cost numeric;
  v_units integer;
  v_recv integer;
  v_new_status text;
begin
  if p_cost_method not in ('keep', 'latest', 'average') then
    raise exception 'Choose how to update the cost' using errcode = '22023';
  end if;
  if p_receipt_key is null or length(p_receipt_key) < 8 then
    raise exception 'A receipt key is required' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 200 then
    raise exception 'Enter how many of at least one part arrived' using errcode = '22023';
  end if;

  select status, po_number into v_status, v_number from public.purchase_orders where id = p_po_id and shop_id = p_shop_id for update;
  if not found then
    raise exception 'That order was not found' using errcode = 'P0002';
  end if;

  select lines into v_prior from public.po_receipts where po_id = p_po_id and receipt_key = p_receipt_key;
  if found then
    return jsonb_build_object('duplicate', true, 'status', v_status, 'lines', v_prior, 'missing', '[]'::jsonb);
  end if;
  if v_status not in ('sent', 'partial') then
    raise exception 'Only a sent order can be received' using errcode = 'P0001';
  end if;

  for it in select * from jsonb_to_recordset(p_items) as x(line_id uuid, qty integer) loop
    if it.qty is null or it.qty = 0 then
      continue;
    end if;
    if it.qty < 0 or it.qty > 100000 then
      raise exception 'Enter how many arrived, 0 or more' using errcode = '22023';
    end if;
    select * into ln from public.purchase_order_lines where id = it.line_id and po_id = p_po_id and shop_id = p_shop_id for update;
    if not found then
      raise exception 'A line on this receipt is not on the order' using errcode = 'P0002';
    end if;
    if ln.qty_received + it.qty > ln.qty and not coalesce(p_allow_over, false) then
      raise exception 'More arrived than was ordered for %. Confirm if the vendor really sent extra.', ln.description using errcode = '23514';
    end if;
    update public.purchase_order_lines set qty_received = qty_received + it.qty where id = ln.id and shop_id = p_shop_id;

    if ln.part_id is not null then
      select qty_on_hand, qty_on_order, cost into pt from public.inventory where id = ln.part_id and shop_id = p_shop_id for update;
      if found then
        v_had := greatest(0, coalesce(pt.qty_on_hand, 0));
        v_cost := pt.cost;
        if ln.unit_cost > 0 then
          if p_cost_method = 'latest' then
            v_cost := round(ln.unit_cost, 2);
          elsif p_cost_method = 'average' then
            v_cost := round(((v_had * coalesce(pt.cost, 0)) + (it.qty * ln.unit_cost)) / (v_had + it.qty), 2);
          end if;
        end if;
        update public.inventory
           set qty_on_hand = v_had + it.qty, qty_on_order = greatest(0, coalesce(pt.qty_on_order, 0) - it.qty), cost = v_cost, updated_at = now()
         where id = ln.part_id and shop_id = p_shop_id;
        insert into public.part_history (shop_id, part_id, actor_id, actor_name, field, old_value, new_value, reason, reference)
        values (p_shop_id, ln.part_id, p_actor_id, left(coalesce(p_actor_name, ''), 120), 'qty_on_hand', pt.qty_on_hand, v_had + it.qty, 'received', v_number);
        if coalesce(pt.qty_on_order, 0) > 0 then
          insert into public.part_history (shop_id, part_id, actor_id, actor_name, field, old_value, new_value, reason, reference)
          values (p_shop_id, ln.part_id, p_actor_id, left(coalesce(p_actor_name, ''), 120), 'qty_on_order', pt.qty_on_order, greatest(0, pt.qty_on_order - it.qty), 'received', v_number);
        end if;
        if v_cost is distinct from pt.cost then
          insert into public.part_history (shop_id, part_id, actor_id, actor_name, field, old_value, new_value, reason, reference)
          values (p_shop_id, ln.part_id, p_actor_id, left(coalesce(p_actor_name, ''), 120), 'cost', pt.cost, v_cost, 'received', v_number);
        end if;
      else
        v_missing := v_missing || to_jsonb(ln.description);
      end if;
    end if;
    v_done := v_done || jsonb_build_object('line_id', ln.id, 'qty', it.qty, 'description', ln.description);
  end loop;

  if jsonb_array_length(v_done) = 0 then
    raise exception 'Enter how many of at least one part arrived' using errcode = '22023';
  end if;

  select coalesce(sum(qty), 0), coalesce(sum(least(qty, qty_received)), 0) into v_units, v_recv
    from public.purchase_order_lines where po_id = p_po_id and shop_id = p_shop_id;
  v_new_status := case when v_units > 0 and v_recv >= v_units then 'received' when v_recv > 0 then 'partial' else 'sent' end;
  update public.purchase_orders
     set status = v_new_status, received_at = case when v_new_status = 'received' then now() else received_at end,
         updated_by = p_actor_id, updated_at = now()
   where id = p_po_id and shop_id = p_shop_id;

  insert into public.po_receipts (shop_id, po_id, receipt_key, cost_method, lines, received_by, received_by_name)
  values (p_shop_id, p_po_id, p_receipt_key, p_cost_method, v_done, p_actor_id, left(coalesce(p_actor_name, ''), 120));

  return jsonb_build_object('duplicate', false, 'status', v_new_status, 'lines', v_done, 'missing', v_missing);
end;
$$;

-- Only the server (service role) may run these. They are never callable from the browser.
revoke all on function public.inventory_apply_delta(uuid, uuid, text, numeric, numeric, uuid, text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.inventory_apply_delta(uuid, uuid, text, numeric, numeric, uuid, text, text, text, text, boolean) to service_role;
revoke all on function public.inventory_set_prices(uuid, jsonb, uuid, text, text) from public, anon, authenticated;
grant execute on function public.inventory_set_prices(uuid, jsonb, uuid, text, text) to service_role;
revoke all on function public.next_po_number(uuid) from public, anon, authenticated;
grant execute on function public.next_po_number(uuid) to service_role;
revoke all on function public.po_save_draft(uuid, uuid, uuid, text, text, date, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.po_save_draft(uuid, uuid, uuid, text, text, date, jsonb, uuid) to service_role;
revoke all on function public.po_mark_sent(uuid, uuid, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.po_mark_sent(uuid, uuid, text, text, uuid, text) to service_role;
revoke all on function public.po_cancel(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.po_cancel(uuid, uuid, uuid, text) to service_role;
revoke all on function public.receive_po_lines(uuid, uuid, text, jsonb, boolean, text, uuid, text) from public, anon, authenticated;
grant execute on function public.receive_po_lines(uuid, uuid, text, jsonb, boolean, text, uuid, text) to service_role;
