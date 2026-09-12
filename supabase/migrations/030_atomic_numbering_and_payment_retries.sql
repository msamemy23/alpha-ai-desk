begin;

-- Allocate document numbers from a row that is locked and incremented in the
-- same transaction as the allocation. A max()+1 query protected by an
-- advisory lock still allows two later document inserts to receive the same
-- number after the allocator transaction ends.
create table if not exists public.document_number_counters (
  shop_id uuid not null references public.shop_profiles(id) on delete cascade,
  document_type text not null check (document_type in ('Invoice', 'Estimate', 'Receipt')),
  document_year integer not null check (document_year between 2000 and 2200),
  next_number integer not null check (next_number > 0),
  updated_at timestamptz not null default now(),
  primary key (shop_id, document_type, document_year)
);

insert into public.document_number_counters (shop_id, document_type, document_year, next_number)
select d.shop_id,
       d.type,
       extract(year from current_date)::integer,
       coalesce(max((regexp_match(d.doc_number, '[0-9]+$'))[1]::integer), 0) + 1
  from public.documents d
 where d.type in ('Invoice', 'Estimate', 'Receipt')
   and d.doc_number ~ ('^(INV|EST|REC)-' || extract(year from current_date)::integer::text || '-[0-9]+$')
 group by d.shop_id, d.type
on conflict (shop_id, document_type, document_year) do update
  set next_number = greatest(public.document_number_counters.next_number, excluded.next_number),
      updated_at = now();

alter table public.document_number_counters enable row level security;
drop policy if exists document_number_counters_select on public.document_number_counters;
drop policy if exists document_number_counters_insert on public.document_number_counters;
drop policy if exists document_number_counters_update on public.document_number_counters;
create policy document_number_counters_select on public.document_number_counters
  for select to authenticated
  using (exists (select 1 from public.shop_profiles sp where sp.id = shop_id and sp.user_id = auth.uid()));
create policy document_number_counters_insert on public.document_number_counters
  for insert to authenticated
  with check (exists (select 1 from public.shop_profiles sp where sp.id = shop_id and sp.user_id = auth.uid()));
create policy document_number_counters_update on public.document_number_counters
  for update to authenticated
  using (exists (select 1 from public.shop_profiles sp where sp.id = shop_id and sp.user_id = auth.uid()))
  with check (exists (select 1 from public.shop_profiles sp where sp.id = shop_id and sp.user_id = auth.uid()));
grant select, insert, update on public.document_number_counters to authenticated, service_role;

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

  insert into public.document_number_counters (shop_id, document_type, document_year, next_number)
  values (p_shop_id, p_type, v_year, 2)
  on conflict (shop_id, document_type, document_year) do update
    set next_number = public.document_number_counters.next_number + 1,
        updated_at = now()
  returning next_number - 1 into v_next;

  return v_prefix || '-' || v_year::text || '-' || lpad(v_next::text, 4, '0');
end;
$$;
revoke all on function public.next_document_number(uuid, text) from public, anon;
grant execute on function public.next_document_number(uuid, text) to authenticated, service_role;

-- Wrap the existing locked payment transaction with a shop/key lock and a
-- payload check. A lost response can safely be retried with the same key, but
-- reusing that key for a different amount, method, note, or document fails.
create or replace function public.record_document_payment_safe(
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
     and exists (
       select 1 from public.shop_profiles sp
        where sp.id = d.shop_id and sp.user_id = auth.uid()
     );
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
revoke all on function public.record_document_payment_safe(uuid, numeric, text, text, text) from public, anon;
grant execute on function public.record_document_payment_safe(uuid, numeric, text, text, text) to authenticated;

commit;
