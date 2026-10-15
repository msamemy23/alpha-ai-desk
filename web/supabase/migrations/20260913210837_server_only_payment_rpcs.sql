-- Payment recording and document numbering are server-owned operations.
-- Browser reads remain available, but no authenticated JWT may execute these
-- SECURITY DEFINER functions directly through PostgREST.

revoke all on function public.next_document_number(uuid, text) from public, anon, authenticated;
grant execute on function public.next_document_number(uuid, text) to service_role;

-- The service wrapper binds the already-verified Alpha user into the request
-- claims for the existing payment guards, then calls the transaction function.
-- It is callable only with the service-role key and is not in the browser's
-- allowed RPC surface.
create or replace function public.record_document_payment_server(
  p_user_id uuid,
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
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if p_user_id is null then
    raise exception 'User binding required' using errcode = '42501';
  end if;

  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  return public.record_document_payment_safe(
    p_document_id,
    p_amount,
    p_method,
    p_note,
    p_idempotency_key
  );
end;
$$;

revoke all on function public.record_document_payment_server(uuid, uuid, numeric, text, text, text) from public, anon, authenticated;
grant execute on function public.record_document_payment_server(uuid, uuid, numeric, text, text, text) to service_role;

revoke all on function public.record_document_payment_safe(uuid, numeric, text, text, text) from public, anon, authenticated;
grant execute on function public.record_document_payment_safe(uuid, numeric, text, text, text) to service_role;
