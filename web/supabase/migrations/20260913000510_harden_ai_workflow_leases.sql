-- Keep long model and retailer lookups alive without weakening fencing.
-- A lease can only be renewed by the exact holder that acquired it, and
-- checkpoints/releases still require that same unexpired fencing token.

create or replace function public.lease_ai_workflow(p_shop_id uuid, p_user_id uuid, p_session_id text, p_lease_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.ai_workflow_sessions;
begin
  if not exists (select 1 from public.shop_memberships where shop_id=p_shop_id and user_id=p_user_id and status='active') then
    raise exception 'Active shop membership required';
  end if;
  insert into public.ai_workflow_sessions(shop_id,user_id,session_id) values(p_shop_id,p_user_id,p_session_id) on conflict do nothing;
  select * into r from public.ai_workflow_sessions where shop_id=p_shop_id and user_id=p_user_id and session_id=p_session_id for update;
  if r.lease_until > now() and r.lease_id is distinct from p_lease_id then return jsonb_build_object('busy',true); end if;
  update public.ai_workflow_sessions set lease_id=p_lease_id, lease_until=now()+interval '10 minutes',updated_at=now()
    where shop_id=p_shop_id and user_id=p_user_id and session_id=p_session_id;
  return jsonb_build_object('state',r.state);
end $$;

create or replace function public.checkpoint_ai_workflow(p_shop_id uuid, p_user_id uuid, p_session_id text, p_lease_id uuid, p_state jsonb, p_release boolean default false)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if octet_length(p_state::text)>1000000 then raise exception 'Conversation storage limit reached'; end if;
  update public.ai_workflow_sessions set state=p_state,updated_at=now(),
    lease_id=case when p_release then null else p_lease_id end,
    lease_until=case when p_release then null else now()+interval '10 minutes' end
    where shop_id=p_shop_id and user_id=p_user_id and session_id=p_session_id and lease_id=p_lease_id and lease_until>now();
  return found;
end $$;

create or replace function public.renew_ai_workflow(p_shop_id uuid, p_user_id uuid, p_session_id text, p_lease_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.ai_workflow_sessions
     set lease_until=now()+interval '10 minutes', updated_at=now()
   where shop_id=p_shop_id and user_id=p_user_id and session_id=p_session_id
     and lease_id=p_lease_id and lease_until>now();
  return found;
end $$;

revoke all on function public.lease_ai_workflow(uuid,uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.checkpoint_ai_workflow(uuid,uuid,text,uuid,jsonb,boolean) from public,anon,authenticated;
revoke all on function public.renew_ai_workflow(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.lease_ai_workflow(uuid,uuid,text,uuid) to service_role;
grant execute on function public.checkpoint_ai_workflow(uuid,uuid,text,uuid,jsonb,boolean) to service_role;
grant execute on function public.renew_ai_workflow(uuid,uuid,text,uuid) to service_role;

