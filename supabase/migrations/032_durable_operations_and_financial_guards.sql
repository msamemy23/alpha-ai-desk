begin;

-- Paid and partially-paid documents are immutable through ordinary updates.
-- Payment recording sets app.payment_transaction inside its transaction, so it
-- remains the only supported path that may update the payment-derived fields.
create or replace function public.prevent_paid_document_financial_edit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status in ('Paid', 'Partial')
     and (
       new.status is distinct from old.status
       or new.type is distinct from old.type
       or new.doc_number is distinct from old.doc_number
       or new.parts is distinct from old.parts
       or new.labors is distinct from old.labors
       or new.shop_supplies is distinct from old.shop_supplies
       or new.sublet is distinct from old.sublet
       or new.tax_rate is distinct from old.tax_rate
       or new.apply_tax is distinct from old.apply_tax
       or new.deposit is distinct from old.deposit
       or new.payment_method is distinct from old.payment_method
       or new.line_items is distinct from old.line_items
       or new.payment_plan is distinct from old.payment_plan
     )
     and coalesce(current_setting('app.payment_transaction', true), '') <> 'record_document_payment' then
    raise exception 'Paid or partially paid documents are financially immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_paid_document_financial_edit on public.documents;
create trigger trg_prevent_paid_document_financial_edit
before update on public.documents
for each row execute function public.prevent_paid_document_financial_edit();

revoke all on function public.prevent_paid_document_financial_edit() from public, anon, authenticated;

-- The invoker numbering RPC needs table DML grants, but browser callers must
-- not be able to forge or advance a counter directly.
create or replace function public.prevent_direct_document_counter_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('app.document_number_allocator', true), '') <> 'next_document_number' then
    raise exception 'Document counters may only be changed by the allocator' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_direct_document_counter_insert on public.document_number_counters;
create trigger trg_prevent_direct_document_counter_insert
before insert on public.document_number_counters
for each row execute function public.prevent_direct_document_counter_change();

drop trigger if exists trg_prevent_direct_document_counter_update on public.document_number_counters;
create trigger trg_prevent_direct_document_counter_update
before update on public.document_number_counters
for each row execute function public.prevent_direct_document_counter_change();

revoke all on function public.prevent_direct_document_counter_change() from public, anon, authenticated;

create or replace function public.next_document_number(p_shop_id uuid, p_type text)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_prefix text;
  v_year integer := extract(year from current_date)::integer;
  v_next integer;
begin
  if auth.role() <> 'service_role' and not exists (
    select 1 from public.shop_profiles sp where sp.id = p_shop_id and sp.user_id = auth.uid()
  ) then
    raise exception 'Shop access denied' using errcode = '42501';
  end if;

  v_prefix := case p_type when 'Estimate' then 'EST' when 'Receipt' then 'REC' when 'Invoice' then 'INV' else null end;
  if v_prefix is null then raise exception 'Unsupported document type' using errcode = '22023'; end if;

  perform set_config('app.document_number_allocator', 'next_document_number', true);
  insert into public.document_number_counters (shop_id, document_type, document_year, next_number)
  values (p_shop_id, p_type, v_year, 2)
  on conflict (shop_id, document_type, document_year) do update
    set next_number = public.document_number_counters.next_number + 1,
        updated_at = now()
  returning next_number - 1 into v_next;

  return v_prefix || '-' || v_year::text || '-' ||
    case when v_next < 10000 then lpad(v_next::text, 4, '0') else v_next::text end;
end;
$$;

revoke all on function public.next_document_number(uuid, text) from public, anon;
grant execute on function public.next_document_number(uuid, text) to authenticated, service_role;

-- Consent is keyed by the actual normalized destination, not by an optional
-- customer row. This prevents phone-only sends and incomplete customer rows
-- from bypassing a STOP received from the same number.
create table if not exists public.sms_consents (
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  phone_digits text not null check (length(phone_digits) between 7 and 20),
  opted_out boolean not null default true,
  source text,
  updated_at timestamptz not null default now(),
  primary key (shop_id, phone_digits)
);
alter table public.sms_consents enable row level security;
revoke all on table public.sms_consents from public, anon, authenticated;
grant all on table public.sms_consents to service_role;

-- A provider call can succeed while the function instance loses its response.
-- Keep a durable payload-bound operation row so retries never send a different
-- payload under the same key or blindly duplicate an uncertain provider call.
create table if not exists public.message_send_operations (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  channel text not null check (channel = 'sms'),
  operation_key text not null check (length(operation_key) between 1 and 240),
  payload_hash text not null check (length(payload_hash) = 64),
  to_number text not null,
  customer_id uuid,
  body text not null,
  status text not null default 'sending' check (status in ('sending', 'sent', 'failed', 'unknown')),
  attempts integer not null default 1 check (attempts > 0),
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, channel, operation_key)
);
alter table public.message_send_operations enable row level security;
revoke all on table public.message_send_operations from public, anon, authenticated;
grant all on table public.message_send_operations to service_role;

create or replace function public.claim_sms_send_operation(
  p_shop_id uuid,
  p_channel text,
  p_operation_key text,
  p_payload_hash text,
  p_to_number text,
  p_customer_id uuid,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_operation public.message_send_operations%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Internal worker only' using errcode = '42501';
  end if;
  if p_channel <> 'sms' or nullif(btrim(coalesce(p_operation_key, '')), '') is null then
    raise exception 'A valid SMS operation is required' using errcode = '22023';
  end if;
  if length(coalesce(p_payload_hash, '')) <> 64 then
    raise exception 'A valid SMS payload hash is required' using errcode = '22023';
  end if;

  insert into public.message_send_operations (
    shop_id, channel, operation_key, payload_hash, to_number, customer_id, body, status, attempts
  ) values (
    p_shop_id, p_channel, p_operation_key, p_payload_hash, p_to_number, p_customer_id, p_body, 'sending', 1
  )
  on conflict (shop_id, channel, operation_key) do nothing
  returning id into v_id;

  if v_id is not null then
    return jsonb_build_object('status', 'claimed', 'operation_id', v_id, 'attempts', 1);
  end if;

  select * into v_operation
    from public.message_send_operations
   where shop_id = p_shop_id and channel = p_channel and operation_key = p_operation_key
   for update;

  if not found then
    raise exception 'SMS operation could not be claimed' using errcode = '40001';
  end if;
  if v_operation.payload_hash <> p_payload_hash
     or v_operation.to_number <> p_to_number
     or v_operation.customer_id is distinct from p_customer_id
     or v_operation.body <> p_body then
    raise exception 'SMS operation key was reused for a different payload' using errcode = '23505';
  end if;
  if v_operation.status = 'sent' then
    return jsonb_build_object('status', 'sent', 'operation_id', v_operation.id, 'provider_message_id', v_operation.provider_message_id);
  end if;
  if v_operation.status = 'sending' then
    return jsonb_build_object('status', 'in_progress', 'operation_id', v_operation.id);
  end if;
  if v_operation.status = 'unknown' then
    return jsonb_build_object('status', 'unknown', 'operation_id', v_operation.id, 'last_error', v_operation.last_error);
  end if;
  if v_operation.attempts >= 3 then
    return jsonb_build_object('status', 'failed', 'operation_id', v_operation.id, 'last_error', v_operation.last_error);
  end if;

  update public.message_send_operations
     set status = 'sending', attempts = attempts + 1, last_error = null, updated_at = now()
   where id = v_operation.id;
  return jsonb_build_object('status', 'claimed', 'operation_id', v_operation.id, 'attempts', v_operation.attempts + 1);
end;
$$;

revoke all on function public.claim_sms_send_operation(uuid, text, text, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_sms_send_operation(uuid, text, text, text, text, uuid, text) to service_role;

commit;
