create or replace function public.expert_register_device(_device_id text, _device_label text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text;
  v_uid uuid;
  v_count int;
  v_exists boolean;
  v_devices jsonb;
begin
  if _device_id is null or length(trim(_device_id)) = 0 then
    raise exception 'device_id required';
  end if;

  select ci.user_type, ci.user_id into v_type, v_uid
  from public.resolve_caller_identity(auth.uid()) ci
  limit 1;

  if v_uid is null then
    raise exception 'not authorized';
  end if;

  select count(distinct ds.device_id),
         bool_or(ds.device_id = _device_id)
    into v_count, v_exists
  from public.device_sessions ds
  where ds.user_type = v_type and ds.user_id = v_uid;

  if coalesce(v_exists, false) = false and coalesce(v_count, 0) >= 2 then
    select coalesce(jsonb_agg(jsonb_build_object(
             'device_id', d.device_id,
             'device_label', d.device_label,
             'last_active_at', d.last_active_at
           ) order by d.last_active_at desc), '[]'::jsonb)
      into v_devices
    from (
      select distinct on (ds.device_id) ds.device_id, ds.device_label, ds.last_active_at
      from public.device_sessions ds
      where ds.user_type = v_type and ds.user_id = v_uid
      order by ds.device_id, ds.last_active_at desc
    ) d;
    return jsonb_build_object('status', 'limit_reached', 'devices', v_devices);
  end if;

  if coalesce(v_exists, false) then
    update public.device_sessions ds
       set last_active_at = now(),
           device_label = coalesce(_device_label, ds.device_label)
     where ds.user_type = v_type and ds.user_id = v_uid and ds.device_id = _device_id;
  else
    insert into public.device_sessions (user_type, user_id, device_id, device_label, last_active_at)
    values (v_type, v_uid, _device_id, _device_label, now());
  end if;

  return jsonb_build_object('status', 'registered');
end;
$$;

revoke all on function public.expert_register_device(text, text) from public, anon;
grant execute on function public.expert_register_device(text, text) to authenticated;

create or replace function public.expert_revoke_device(_device_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text;
  v_uid uuid;
begin
  select ci.user_type, ci.user_id into v_type, v_uid
  from public.resolve_caller_identity(auth.uid()) ci
  limit 1;
  if v_uid is null then
    raise exception 'not authorized';
  end if;
  delete from public.device_sessions ds
   where ds.user_type = v_type and ds.user_id = v_uid and ds.device_id = _device_id;
end;
$$;

revoke all on function public.expert_revoke_device(text) from public, anon;
grant execute on function public.expert_revoke_device(text) to authenticated;