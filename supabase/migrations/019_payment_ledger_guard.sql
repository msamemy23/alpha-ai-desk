-- Enforce the payment ledger as an append-only, atomic workflow.
-- Direct client writes cannot create fake payment history or bypass amount_paid.
create or replace function public.prevent_direct_payment_ledger_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('app.payment_transaction', true), '') <> 'record_document_payment' then
    raise exception 'Payments can only be changed by the payment transaction' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_direct_payment_ledger_change() from public, anon, authenticated;

drop trigger if exists payments_ledger_guard on public.payments;
create trigger payments_ledger_guard
before insert or update or delete on public.payments
for each row execute function public.prevent_direct_payment_ledger_change();

create or replace function public.record_document_payment(
  p_document_id uuid,
  p_amount numeric,
  p_method text default 'unspecified',
  p_note text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_doc public.documents%rowtype;
  v_part jsonb;
  v_labor jsonb;
  v_raw text;
  v_key text;
  v_qty numeric;
  v_unit_price numeric;
  v_core numeric;
  v_hours numeric;
  v_rate numeric;
  v_shop_supplies numeric;
  v_sublet numeric;
  v_tax_rate numeric;
  v_parts_total numeric := 0;
  v_labor_total numeric := 0;
  v_core_total numeric := 0;
  v_taxable_base numeric := 0;
  v_tax_amount numeric := 0;
  v_subtotal numeric := 0;
  v_total numeric := 0;
  v_paid numeric := 0;
  v_payment_amount numeric;
  v_new_paid numeric;
  v_balance_due numeric;
  v_has_flat boolean;
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  v_payment_amount := round(coalesce(p_amount, 0), 2);
  if v_payment_amount <= 0 then
    raise exception 'Payment amount must be greater than zero' using errcode = '22023';
  end if;

  select d.*
    into v_doc
    from public.documents d
   where d.id = p_document_id
     and exists (
       select 1
         from public.shop_profiles sp
        where sp.id = d.shop_id
          and sp.user_id = auth.uid()
     )
   for update;

  if not found then
    raise exception 'Document not found for this shop' using errcode = '42501';
  end if;

  if coalesce(v_doc.type, '') not in ('Invoice', 'Receipt') then
    raise exception 'Only invoices and receipts can receive payments' using errcode = '22023';
  end if;

  for v_part in
    select value from jsonb_array_elements(coalesce(v_doc.parts, '[]'::jsonb))
  loop
    v_raw := regexp_replace(coalesce(v_part->>'qty', ''), '[$,[:space:]]', '', 'g');
    if v_raw ~ '^-?[0-9]+(\.[0-9]+)?$' then v_qty := v_raw::numeric; else v_qty := 1; end if;

    v_raw := regexp_replace(coalesce(v_part->>'unitPrice', ''), '[$,[:space:]]', '', 'g');
    if v_raw ~ '^-?[0-9]+(\.[0-9]+)?$' then v_unit_price := v_raw::numeric; else v_unit_price := 0; end if;

    v_raw := regexp_replace(coalesce(v_part->>'core', ''), '[$,[:space:]]', '', 'g');
    if v_raw ~ '^-?[0-9]+(\.[0-9]+)?$' then v_core := v_raw::numeric; else v_core := 0; end if;

    v_parts_total := v_parts_total + (v_qty * v_unit_price);
    v_core_total := v_core_total + (v_qty * v_core);
    if lower(coalesce(v_part->>'taxable', 'true')) <> 'false' then
      v_taxable_base := v_taxable_base + (v_qty * v_unit_price);
    end if;
  end loop;

  for v_labor in
    select value from jsonb_array_elements(coalesce(v_doc.labors, '[]'::jsonb))
  loop
    v_has_flat := false;
    foreach v_key in array array['amount', 'flat_amount', 'flatAmount']
    loop
      if v_labor ? v_key then
        v_raw := regexp_replace(coalesce(v_labor->>v_key, ''), '[$,[:space:]]', '', 'g');
        if v_raw ~ '^-?[0-9]+(\.[0-9]+)?$' then
          v_labor_total := v_labor_total + v_raw::numeric;
          v_has_flat := true;
          exit;
        end if;
      end if;
    end loop;

    if not v_has_flat and not (v_labor ? 'hours') and not (v_labor ? 'rate') and (v_labor ? 'total') then
      v_raw := regexp_replace(coalesce(v_labor->>'total', ''), '[$,[:space:]]', '', 'g');
      if v_raw ~ '^-?[0-9]+(\.[0-9]+)?$' then
        v_labor_total := v_labor_total + v_raw::numeric;
        v_has_flat := true;
      end if;
    end if;

    if not v_has_flat then
      v_raw := regexp_replace(coalesce(v_labor->>'hours', ''), '[$,[:space:]]', '', 'g');
      if v_raw ~ '^-?[0-9]+(\.[0-9]+)?$' then v_hours := v_raw::numeric; else v_hours := 0; end if;
      v_raw := regexp_replace(coalesce(v_labor->>'rate', ''), '[$,[:space:]]', '', 'g');
      if v_raw ~ '^-?[0-9]+(\.[0-9]+)?$' then v_rate := v_raw::numeric; else v_rate := 0; end if;
      v_labor_total := v_labor_total + (v_hours * v_rate);
    end if;
  end loop;

  v_raw := regexp_replace(coalesce(v_doc.shop_supplies::text, '0'), '[$,[:space:]]', '', 'g');
  if v_raw ~ '^-?[0-9]+(\.[0-9]+)?$' then v_shop_supplies := v_raw::numeric; else v_shop_supplies := 0; end if;
  v_raw := regexp_replace(coalesce(v_doc.sublet::text, '0'), '[$,[:space:]]', '', 'g');
  if v_raw ~ '^-?[0-9]+(\.[0-9]+)?$' then v_sublet := v_raw::numeric; else v_sublet := 0; end if;
  v_raw := regexp_replace(coalesce(v_doc.tax_rate::text, ''), '[$,[:space:]]', '', 'g');
  if v_raw ~ '^-?[0-9]+(\.[0-9]+)?$' and v_raw::numeric >= 0 then v_tax_rate := v_raw::numeric; else v_tax_rate := 8.25; end if;

  v_subtotal := v_labor_total + v_parts_total + v_shop_supplies + v_sublet + v_core_total;
  if coalesce(v_doc.apply_tax, true) then
    v_taxable_base := v_taxable_base + v_shop_supplies + v_sublet;
    v_tax_amount := v_taxable_base * (v_tax_rate / 100);
  end if;
  v_total := round(v_subtotal + v_tax_amount, 2);
  v_paid := greatest(round(coalesce(v_doc.amount_paid, 0), 2), 0);
  v_balance_due := greatest(v_total - v_paid, 0);

  if v_payment_amount > v_balance_due + 0.005 then
    raise exception 'Payment exceeds the remaining balance of %' , v_balance_due using errcode = '22003';
  end if;

  v_new_paid := round(v_paid + v_payment_amount, 2);
  v_status := case when v_new_paid >= v_total then 'Paid' else 'Partial' end;

  perform set_config('app.payment_transaction', 'record_document_payment', true);

  insert into public.payments (
    shop_id, document_id, customer_id, amount, method, note, paid_at, created_at
  ) values (
    v_doc.shop_id,
    v_doc.id,
    v_doc.customer_id,
    v_payment_amount,
    coalesce(nullif(trim(p_method), ''), 'unspecified'),
    nullif(trim(coalesce(p_note, '')), ''),
    now(),
    now()
  );

  update public.documents
     set amount_paid = v_new_paid,
         status = v_status,
         updated_at = now()
   where id = v_doc.id
     and shop_id = v_doc.shop_id;

  return jsonb_build_object(
    'document_id', v_doc.id,
    'shop_id', v_doc.shop_id,
    'amount_paid', v_new_paid,
    'status', v_status,
    'balance_due', greatest(v_total - v_new_paid, 0),
    'total', v_total
  );
end;
$$;
revoke all on function public.record_document_payment(uuid, numeric, text, text) from public, anon;
grant execute on function public.record_document_payment(uuid, numeric, text, text) to authenticated;
