begin;

-- Canonical payment ledger fields. Existing payment rows are preserved.
alter table public.payments add column if not exists idempotency_key text;
alter table public.scheduled_messages add column if not exists attempts integer not null default 0;
alter table public.scheduled_messages add column if not exists claimed_at timestamptz;
alter table public.scheduled_messages add column if not exists next_attempt_at timestamptz;
alter table public.scheduled_messages add column if not exists last_error text;
alter table public.scheduled_messages add column if not exists sent_at timestamptz;
alter table public.scheduled_messages add column if not exists idempotency_key text;
alter table public.social_posts add column if not exists media_paths text[] not null default '{}';

-- Repair the two known duplicate document numbers deterministically before the
-- uniqueness guarantee is added. The first row keeps the original number;
-- subsequent rows receive an opaque, stable suffix derived from their UUID.
with duplicate_documents as (
  select id, doc_number,
         row_number() over (partition by shop_id, doc_number order by created_at nulls first, id) as row_number
    from public.documents
   where doc_number is not null
     and btrim(doc_number) <> ''
)
update public.documents as d
   set doc_number = d.doc_number || '-' || left(d.id::text, 8),
       updated_at = now()
  from duplicate_documents as duplicate
 where d.id = duplicate.id
   and duplicate.row_number > 1;

create unique index if not exists documents_shop_doc_number_unique
  on public.documents (shop_id, doc_number)
  where doc_number is not null and btrim(doc_number) <> '';

create unique index if not exists payments_shop_idempotency_key_unique
  on public.payments (shop_id, idempotency_key)
  where idempotency_key is not null and btrim(idempotency_key) <> '';

create unique index if not exists scheduled_messages_shop_idempotency_key_unique
  on public.scheduled_messages (shop_id, idempotency_key)
  where idempotency_key is not null and btrim(idempotency_key) <> '';

-- Older documents recorded amount_paid without a payment ledger row. Create a
-- clearly labelled historical row for those documents so reports can use the
-- ledger going forward. No document amount or status is overwritten.
do $$
declare
  historical record;
begin
  for historical in
    select d.id, d.shop_id, d.customer_id, d.amount_paid, d.created_at, d.payment_method
      from public.documents d
     where coalesce(d.amount_paid, 0) > 0
       and not exists (select 1 from public.payments p where p.document_id = d.id)
  loop
    perform set_config('app.payment_transaction', 'record_document_payment', true);
    insert into public.payments (
      shop_id, document_id, customer_id, amount, method, note, paid_at, created_at
    ) values (
      historical.shop_id,
      historical.id,
      historical.customer_id,
      round(historical.amount_paid, 2),
      coalesce(nullif(btrim(historical.payment_method), ''), 'historical_import'),
      'Historical payment reconstructed from documents.amount_paid; original payment date unavailable',
      coalesce(historical.created_at, now()),
      coalesce(historical.created_at, now())
    );
  end loop;
end;
$$;

-- A single authenticated, locked transaction is the only way to create a new
-- payment. The idempotency key makes browser retries safe.
create or replace function public.record_document_payment(
  p_document_id uuid,
  p_amount numeric,
  p_method text default 'unspecified',
  p_note text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_doc public.documents%rowtype;
  v_existing public.payments%rowtype;
  v_part jsonb;
  v_labor jsonb;
  v_raw text;
  v_key text;
  v_line_key text;
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
  v_payment_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  v_key := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  if length(v_key) > 120 then
    raise exception 'Payment idempotency key is too long' using errcode = '22023';
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
       select 1 from public.shop_profiles sp
        where sp.id = d.shop_id and sp.user_id = auth.uid()
     )
   for update;

  if not found then
    raise exception 'Document not found for this shop' using errcode = '42501';
  end if;
  if coalesce(v_doc.type, '') not in ('Invoice', 'Receipt') then
    raise exception 'Only invoices and receipts can receive payments' using errcode = '22023';
  end if;

  if v_key is not null then
    select p.* into v_existing
      from public.payments p
     where p.shop_id = v_doc.shop_id and p.idempotency_key = v_key
     limit 1;
    if found then
      if v_existing.document_id is distinct from v_doc.id then
        raise exception 'Payment idempotency key was already used for another document' using errcode = '23505';
      end if;
      return jsonb_build_object(
        'idempotent', true,
        'payment_id', v_existing.id,
        'document_id', v_doc.id,
        'shop_id', v_doc.shop_id,
        'amount_paid', round(coalesce(v_doc.amount_paid, 0), 2),
        'status', v_doc.status
      );
    end if;
  end if;

  for v_part in select value from jsonb_array_elements(coalesce(v_doc.parts, '[]'::jsonb)) loop
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

  for v_labor in select value from jsonb_array_elements(coalesce(v_doc.labors, '[]'::jsonb)) loop
    v_has_flat := false;
    foreach v_line_key in array array['amount', 'flat_amount', 'flatAmount'] loop
      if v_labor ? v_line_key then
        v_raw := regexp_replace(coalesce(v_labor->>v_line_key, ''), '[$,[:space:]]', '', 'g');
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
    raise exception 'Payment exceeds the remaining balance of %', v_balance_due using errcode = '22003';
  end if;

  v_new_paid := round(v_paid + v_payment_amount, 2);
  v_status := case when v_new_paid >= v_total then 'Paid' else 'Partial' end;
  perform set_config('app.payment_transaction', 'record_document_payment', true);

  insert into public.payments (
    shop_id, document_id, customer_id, amount, method, note, idempotency_key, paid_at, created_at
  ) values (
    v_doc.shop_id, v_doc.id, v_doc.customer_id, v_payment_amount,
    coalesce(nullif(trim(p_method), ''), 'unspecified'),
    nullif(trim(coalesce(p_note, '')), ''), v_key, now(), now()
  ) returning id into v_payment_id;

  update public.documents
     set amount_paid = v_new_paid, status = v_status, updated_at = now()
   where id = v_doc.id and shop_id = v_doc.shop_id;

  return jsonb_build_object(
    'idempotent', false, 'payment_id', v_payment_id,
    'document_id', v_doc.id, 'shop_id', v_doc.shop_id, 'amount_paid', v_new_paid,
    'status', v_status, 'balance_due', greatest(v_total - v_new_paid, 0), 'total', v_total
  );
end;
$$;

-- Keep the old four-argument RPC working for already-deployed clients while
-- routing it through the idempotent implementation.
create or replace function public.record_document_payment(
  p_document_id uuid, p_amount numeric, p_method text default 'unspecified', p_note text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
begin
  return public.record_document_payment(p_document_id, p_amount, p_method, p_note, null);
end;
$$;
revoke all on function public.record_document_payment(uuid, numeric, text, text) from public, anon;
revoke all on function public.record_document_payment(uuid, numeric, text, text, text) from public, anon;
grant execute on function public.record_document_payment(uuid, numeric, text, text) to authenticated;
grant execute on function public.record_document_payment(uuid, numeric, text, text, text) to authenticated;

-- Serialize document numbering per shop/type/year. This removes the max+1
-- race that used to produce duplicate invoice numbers.
create or replace function public.next_document_number(p_shop_id uuid, p_type text)
returns text
language plpgsql
security definer
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
  perform pg_advisory_xact_lock(hashtextextended(p_shop_id::text || ':' || p_type || ':' || v_year::text, 0));
  select coalesce(max(substring(d.doc_number from '([0-9]+)$')::integer), 0) + 1
    into v_next
    from public.documents d
   where d.shop_id = p_shop_id
     and d.type = p_type
     and d.doc_number ~ ('^' || v_prefix || '-' || v_year::text || '-[0-9]+$');
  return v_prefix || '-' || v_year::text || '-' || lpad(v_next::text, 4, '0');
end;
$$;
revoke all on function public.next_document_number(uuid, text) from public, anon;
grant execute on function public.next_document_number(uuid, text) to authenticated, service_role;

-- Durable automation execution claims. A failed or abandoned attempt can be
-- retried, but a successful window is never executed twice.
create table if not exists public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null,
  automation_id text not null,
  window_key text not null,
  status text not null default 'running',
  attempts integer not null default 0,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  next_attempt_at timestamptz,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  unique (shop_id, automation_id, window_key)
);
alter table public.automation_runs enable row level security;
revoke all on table public.automation_runs from public, anon, authenticated;

create or replace function public.claim_automation_run(
  p_shop_id uuid, p_automation_id text, p_window_key text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed_id uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'Internal worker only' using errcode = '42501'; end if;
  insert into public.automation_runs (shop_id, automation_id, window_key, status, attempts, started_at)
  values (p_shop_id, p_automation_id, p_window_key, 'running', 1, now())
  on conflict (shop_id, automation_id, window_key) do update
    set status = 'running', attempts = public.automation_runs.attempts + 1,
        started_at = now(), finished_at = null, next_attempt_at = null,
        error = null, result = null
    where (
      public.automation_runs.status in ('failed', 'unknown')
      and public.automation_runs.attempts < 3
      and coalesce(public.automation_runs.next_attempt_at, now()) <= now()
    ) or (
      public.automation_runs.status = 'running'
      and public.automation_runs.started_at < now() - interval '15 minutes'
      and public.automation_runs.attempts < 3
    )
  returning id into v_claimed_id;
  return found;
end;
$$;
revoke all on function public.claim_automation_run(uuid, text, text) from public, anon, authenticated;
grant execute on function public.claim_automation_run(uuid, text, text) to service_role;

-- Transactional replacement prevents split-brain AI history after a failed
-- delete/insert pair. This RPC is intentionally service-role-only.
create or replace function public.replace_ai_chat_history(
  p_shop_id uuid, p_user_id uuid, p_session_id text, p_messages jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then raise exception 'Internal worker only' using errcode = '42501'; end if;
  delete from public.ai_chat_history
   where shop_id = p_shop_id and user_id = p_user_id and session_id = p_session_id;
  insert into public.ai_chat_history (shop_id, user_id, session_id, role, content, created_at)
  select p_shop_id, p_user_id, p_session_id,
         case when message->>'role' in ('user', 'browser') then message->>'role' else 'assistant' end,
         message::text, now()
    from jsonb_array_elements(coalesce(p_messages, '[]'::jsonb)) as entry(message);
end;
$$;
revoke all on function public.replace_ai_chat_history(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.replace_ai_chat_history(uuid, uuid, text, jsonb) to service_role;

-- Prevent cross-shop foreign-key-like references even where the legacy schema
-- only had independent nullable UUID columns.
create or replace function public.prevent_cross_shop_reference()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new jsonb := to_jsonb(new);
  v_shop_id uuid;
  v_related_shop uuid;
  v_related_id uuid;
  v_ref record;
begin
  if nullif(v_new->>'shop_id', '') is null then return new; end if;
  v_shop_id := (v_new->>'shop_id')::uuid;
  for v_ref in
    select * from (values
      ('customer_id', 'customers'),
      ('job_id', 'jobs'),
      ('document_id', 'documents')
    ) as refs(column_name, table_name)
   where v_new ? refs.column_name
     and nullif(v_new->>refs.column_name, '') is not null
     and (
       (tg_table_name in ('documents','jobs','vehicles','appointments','scheduled_messages','payments','messages') and refs.column_name = 'customer_id') or
       (tg_table_name = 'documents' and refs.column_name = 'job_id') or
       (tg_table_name in ('payments','messages') and refs.column_name = 'document_id')
     )
  loop
    if to_regclass('public.' || v_ref.table_name) is null then
      continue;
    end if;
    v_related_id := (v_new->>v_ref.column_name)::uuid;
    execute format('select shop_id from public.%I where id = $1', v_ref.table_name)
       into v_related_shop using v_related_id;
    if not found or v_related_shop is distinct from v_shop_id then
      raise exception '% cannot reference a record from another shop', v_ref.column_name using errcode = '23514';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.prevent_cross_shop_reference() from public, anon, authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['documents','jobs','vehicles','appointments','scheduled_messages','payments','messages'] loop
    if to_regclass('public.' || table_name) is not null then
      execute format('drop trigger if exists %I on public.%I', table_name || '_same_shop_guard', table_name);
      execute format('create trigger %I before insert or update on public.%I for each row execute function public.prevent_cross_shop_reference()', table_name || '_same_shop_guard', table_name);
    end if;
  end loop;
end;
$$;

-- Audit records are server-owned. No browser role may write or read them.
do $$
declare
  table_name text;
begin
  foreach table_name in array array['audit_log','audit_logs'] loop
    if to_regclass('public.' || table_name) is not null then
      execute format('revoke all privileges on table public.%I from public, anon, authenticated', table_name);
    end if;
  end loop;
end;
$$;

-- Reproduce the private media storage contract used by social drafts.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('social-post-media', 'social-post-media', false, 10485760, array['image/*', 'video/*'])
on conflict (id) do update set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create index if not exists payments_shop_paid_at_idx on public.payments (shop_id, paid_at);
create index if not exists scheduled_messages_due_idx on public.scheduled_messages (status, scheduled_for, next_attempt_at);
create index if not exists automation_runs_shop_status_idx on public.automation_runs (shop_id, status, next_attempt_at);

commit;
