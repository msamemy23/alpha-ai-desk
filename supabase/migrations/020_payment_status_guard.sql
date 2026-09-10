-- Payment status is part of the protected ledger state.
create or replace function public.prevent_direct_payment_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('app.payment_transaction', true), '') = 'record_document_payment' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if coalesce(new.status, '') in ('Paid', 'Partial') then
      raise exception 'Paid and Partial documents require the payment transaction' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.status is distinct from old.status
     and (coalesce(old.status, '') in ('Paid', 'Partial')
       or coalesce(new.status, '') in ('Paid', 'Partial')) then
    raise exception 'Paid and Partial status can only be changed by the payment transaction' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_direct_payment_status_change() from public, anon, authenticated;

drop trigger if exists documents_payment_status_guard on public.documents;
create trigger documents_payment_status_guard
before insert or update of status on public.documents
for each row execute function public.prevent_direct_payment_status_change();
