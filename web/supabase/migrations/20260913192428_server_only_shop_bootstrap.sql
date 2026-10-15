-- Keep shop bootstrap behind the authenticated server endpoint. The endpoint
-- validates the Supabase session, then invokes the service-role-only function
-- with that exact user id.

create or replace function public.bootstrap_shop_profile(
  p_user_id uuid,
  p_shop_name text default 'My Shop'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_shop_id uuid;
  v_created boolean := false;
begin
  if p_user_id is null then
    raise exception 'A user is required to create a shop' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select sm.shop_id into v_shop_id
  from public.shop_memberships sm
  where sm.user_id = p_user_id and sm.status = 'active'
  order by sm.created_at, sm.shop_id
  limit 1;
  if found then
    return jsonb_build_object('id', v_shop_id, 'created', false);
  end if;

  if exists (select 1 from public.shop_profiles where user_id = p_user_id)
     or exists (select 1 from public.shop_memberships where user_id = p_user_id) then
    raise exception 'Your shop access is inactive. Contact the shop owner.' using errcode = '42501';
  end if;

  insert into public.shop_profiles(user_id, shop_name)
  values (p_user_id, left(coalesce(nullif(trim(p_shop_name), ''), 'My Shop'), 120))
  returning id into v_shop_id;
  v_created := true;

  if not exists (
    select 1 from public.shop_memberships
    where shop_id = v_shop_id and user_id = p_user_id
      and role = 'owner' and status = 'active'
  ) then
    raise exception 'Shop membership could not be created';
  end if;

  return jsonb_build_object('id', v_shop_id, 'created', v_created);
end;
$function$;

revoke all on function public.ensure_shop_profile(text) from public;
revoke all on function public.ensure_shop_profile(text) from anon, authenticated;
revoke all on function public.bootstrap_shop_profile(uuid, text) from public;
revoke all on function public.bootstrap_shop_profile(uuid, text) from anon, authenticated;
grant execute on function public.bootstrap_shop_profile(uuid, text) to service_role;
