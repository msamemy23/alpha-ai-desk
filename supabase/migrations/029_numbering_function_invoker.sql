-- The numbering RPC only reads tenant-visible rows and already checks shop
-- ownership. Keep it invoker-secure so an authenticated caller never executes
-- it with elevated table privileges.
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
