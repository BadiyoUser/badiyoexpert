create table if not exists public._device_limit_test (step text, result jsonb);
grant all on public._device_limit_test to service_role;
alter table public._device_limit_test enable row level security;

do $$
declare
  v_expert uuid := '75d3e2ab-47b0-478f-9abc-dcfd108acc93';
  r jsonb;
begin
  delete from public._device_limit_test;
  perform set_config('request.jwt.claims', json_build_object('sub','fee377a1-dc04-4d07-8793-2ecb87ac5e46','role','authenticated')::text, true);

  r := public.expert_register_device('sim-device-A','Android · A');
  insert into public._device_limit_test values ('device A', r);
  r := public.expert_register_device('sim-device-B','Android · B');
  insert into public._device_limit_test values ('device B', r);
  r := public.expert_register_device('sim-device-C','Android · C');
  insert into public._device_limit_test values ('device C (3rd)', r);
  r := public.expert_register_device('sim-device-A','Android · A');
  insert into public._device_limit_test values ('device A again', r);

  perform public.expert_revoke_device('sim-device-B');
  r := public.expert_register_device('sim-device-C','Android · C');
  insert into public._device_limit_test values ('device C after logging out B', r);

  -- cleanup simulated rows
  delete from public.device_sessions
   where user_type = 'expert' and user_id = v_expert
     and device_id in ('sim-device-A','sim-device-B','sim-device-C');
end $$;