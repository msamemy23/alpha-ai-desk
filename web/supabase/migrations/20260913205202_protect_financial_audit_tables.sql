-- Keep browser reads where the UI needs them, but make all authoritative
-- writes go through server routes or guarded RPCs. RLS alone is not enough:
-- a member with an authenticated JWT must not be able to forge a payment,
-- advance invoice numbering, rewrite the audit trail, or inject an outbound
-- message by calling PostgREST directly.

alter table if exists public.documents enable row level security;
alter table if exists public.payments enable row level security;
alter table if exists public.audit_logs enable row level security;
alter table if exists public.audit_log enable row level security;
alter table if exists public.document_number_counters enable row level security;
alter table if exists public.scheduled_messages enable row level security;
alter table if exists public.messages enable row level security;

-- Documents are readable in the browser for the document list. Creation and
-- edits are performed by /api/ai-action and the other authenticated routes.
drop policy if exists tenant_insert on public.documents;
drop policy if exists tenant_update on public.documents;
drop policy if exists tenant_delete on public.documents;
drop policy if exists documents_service_role_only on public.documents;
create policy documents_service_role_only on public.documents
  for all to service_role using (true) with check (true);
revoke insert, update, delete on public.documents from authenticated;
grant select on public.documents to authenticated;

-- Payments are ledger entries. The only authenticated write path is the
-- record_document_payment_safe RPC below; direct table DML is removed.
drop policy if exists tenant_insert on public.payments;
drop policy if exists tenant_update on public.payments;
drop policy if exists tenant_delete on public.payments;
drop policy if exists payments_service_role_only on public.payments;
create policy payments_service_role_only on public.payments
  for all to service_role using (true) with check (true);
revoke insert, update, delete on public.payments from authenticated;
grant select on public.payments to authenticated;

-- The app writes audit records through the service-role audit helper. Keeping
-- these tables non-writable (and non-readable) to browser roles prevents a
-- user from changing the evidence used to reconcile an external side effect.
drop policy if exists tenant_select on public.audit_logs;
drop policy if exists tenant_insert on public.audit_logs;
drop policy if exists tenant_update on public.audit_logs;
drop policy if exists tenant_delete on public.audit_logs;
drop policy if exists audit_logs_service_role_only on public.audit_logs;
create policy audit_logs_service_role_only on public.audit_logs
  for all to service_role using (true) with check (true);
revoke all on public.audit_logs from authenticated;

drop policy if exists tenant_select on public.audit_log;
drop policy if exists tenant_insert on public.audit_log;
drop policy if exists tenant_update on public.audit_log;
drop policy if exists tenant_delete on public.audit_log;
drop policy if exists audit_log_service_role_only on public.audit_log;
create policy audit_log_service_role_only on public.audit_log
  for all to service_role using (true) with check (true);
revoke all on public.audit_log from authenticated;

-- Counters are mutated only by the number allocator RPC. No browser needs to
-- read this internal table.
drop policy if exists document_number_counters_select on public.document_number_counters;
drop policy if exists document_number_counters_insert on public.document_number_counters;
drop policy if exists document_number_counters_update on public.document_number_counters;
drop policy if exists document_number_counters_delete on public.document_number_counters;
drop policy if exists document_number_counters_service_role_only on public.document_number_counters;
create policy document_number_counters_service_role_only on public.document_number_counters
  for all to service_role using (true) with check (true);
revoke all on public.document_number_counters from authenticated;

-- Scheduled messages are created and edited through /api/scheduled-messages;
-- the dispatcher is the only component that transitions them to delivery
-- states. Keep SELECT for existing read-only clients.
drop policy if exists tenant_insert on public.scheduled_messages;
drop policy if exists tenant_update on public.scheduled_messages;
drop policy if exists tenant_delete on public.scheduled_messages;
drop policy if exists scheduled_messages_service_role_only on public.scheduled_messages;
create policy scheduled_messages_service_role_only on public.scheduled_messages
  for all to service_role using (true) with check (true);
revoke insert, update, delete on public.scheduled_messages from authenticated;
grant select on public.scheduled_messages to authenticated;

-- Message bodies and delivery identities are server-owned. The UI only needs
-- to mark an inbound message read, so expose that single column as an update.
drop policy if exists tenant_insert on public.messages;
drop policy if exists tenant_update on public.messages;
drop policy if exists tenant_delete on public.messages;
drop policy if exists messages_mark_read on public.messages;
create policy messages_mark_read on public.messages
  for update to authenticated
  using (private.user_has_shop_access(shop_id))
  with check (private.user_has_shop_access(shop_id));
revoke insert, update, delete on public.messages from authenticated;
grant select on public.messages to authenticated;
grant update (read) on public.messages to authenticated;

-- The allocator needs to write the counter under its own transaction while
-- preserving the caller's membership check. The existing trigger still
-- requires app.document_number_allocator=next_document_number.
create or replace function public.next_document_number(p_shop_id uuid, p_type text)
returns text
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_prefix text;
  v_year integer := extract(year from current_date)::integer;
  v_next integer;
begin
  if auth.role() <> 'service_role' and not private.user_can_write_shop(p_shop_id) then
    raise exception 'Shop access denied' using errcode = '42501';
  end if;

  v_prefix := case p_type
    when 'Estimate' then 'EST'
    when 'Receipt' then 'REC'
    when 'Invoice' then 'INV'
    else null
  end;
  if v_prefix is null then
    raise exception 'Unsupported document type' using errcode = '22023';
  end if;

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

-- Keep the raw payment transaction server-owned. The safe wrapper is the
-- authenticated entry point and checks the caller's write role before it
-- invokes this SECURITY DEFINER transaction.
alter function public.record_document_payment(uuid, numeric, text, text, text)
  security definer;
alter function public.record_document_payment(uuid, numeric, text, text, text)
  set search_path = public, private, pg_temp;
alter function public.record_document_payment(uuid, numeric, text, text)
  security definer;
alter function public.record_document_payment(uuid, numeric, text, text)
  set search_path = public, private, pg_temp;

create or replace function public.record_document_payment_safe(
  p_document_id uuid,
  p_amount numeric,
  p_method text default 'unspecified',
  p_note text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_shop_id uuid;
  v_key text;
  v_existing public.payments%rowtype;
  v_method text := coalesce(nullif(trim(coalesce(p_method, '')), ''), 'unspecified');
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select d.shop_id into v_shop_id
    from public.documents d
   where d.id = p_document_id
     and private.user_can_write_shop(d.shop_id);
  if not found then
    raise exception 'Document not found for this shop' using errcode = '42501';
  end if;

  v_key := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  if v_key is null then
    return public.record_document_payment(p_document_id, p_amount, v_method, v_note, null);
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_shop_id::text || ':payment:' || v_key, 0));
  select p.* into v_existing
    from public.payments p
   where p.shop_id = v_shop_id and p.idempotency_key = v_key
   limit 1;
  if found then
    if v_existing.document_id is distinct from p_document_id then
      raise exception 'Payment idempotency key was already used for another document' using errcode = '23505';
    end if;
    if round(coalesce(v_existing.amount, 0), 2) is distinct from round(coalesce(p_amount, 0), 2)
       or lower(coalesce(nullif(trim(v_existing.method), ''), 'unspecified')) is distinct from lower(v_method)
       or nullif(trim(coalesce(v_existing.note, '')), '') is distinct from v_note then
      raise exception 'Payment idempotency key was already used for a different payment payload' using errcode = '23505';
    end if;
  end if;

  return public.record_document_payment(p_document_id, p_amount, v_method, v_note, v_key);
end;
$$;
revoke all on function public.record_document_payment(uuid, numeric, text, text) from public, anon, authenticated;
revoke all on function public.record_document_payment(uuid, numeric, text, text, text) from public, anon, authenticated;
grant execute on function public.record_document_payment(uuid, numeric, text, text), public.record_document_payment(uuid, numeric, text, text, text) to service_role;
revoke all on function public.record_document_payment_safe(uuid, numeric, text, text, text) from public, anon;
grant execute on function public.record_document_payment_safe(uuid, numeric, text, text, text) to authenticated;
