-- Keep amount_paid under the same atomic payment workflow as the payment ledger.
create or replace function public.prevent_direct_document_payment_amount_change()
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
    if coalesce(new.amount_paid, 0) <> 0 then
      raise exception 'amount_paid is set only by the payment transaction' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.amount_paid is distinct from old.amount_paid then
    raise exception 'amount_paid can only be changed by the payment transaction' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_direct_document_payment_amount_change() from public, anon, authenticated;

drop trigger if exists documents_payment_amount_guard on public.documents;
create trigger documents_payment_amount_guard
before insert or update of amount_paid on public.documents
for each row execute function public.prevent_direct_document_payment_amount_change();
