CREATE OR REPLACE FUNCTION public.claim_booking_as_expert(p_booking_id uuid)
 RETURNS bookings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_expert_id uuid;
  v_exp_lat numeric;
  v_exp_lng numeric;
  v_is_busy boolean;
  v_bk_lat numeric;
  v_bk_lng numeric;
  v_radius numeric;
  v_distance numeric;
  v_current_status text;
  v_current_assigned uuid;
  v_row public.bookings;
  v_expert_name text;
BEGIN
  v_expert_id := public.get_expert_id_for_auth(auth.uid());
  IF v_expert_id IS NULL THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'; END IF;

  SELECT current_lat, current_lng, is_busy, name
    INTO v_exp_lat, v_exp_lng, v_is_busy, v_expert_name
    FROM public.experts WHERE id = v_expert_id FOR UPDATE;

  IF v_is_busy THEN
    RAISE EXCEPTION 'You already have an active booking. Complete it before accepting a new one.';
  END IF;
  IF v_exp_lat IS NULL OR v_exp_lng IS NULL THEN
    RAISE EXCEPTION 'You are outside the service radius for this booking.';
  END IF;

  SELECT broadcast_radius_km INTO v_radius FROM public.dispatch_config LIMIT 1;
  IF v_radius IS NULL THEN v_radius := 5; END IF;

  SELECT booking_lat, booking_lng, status, assigned_expert_id
    INTO v_bk_lat, v_bk_lng, v_current_status, v_current_assigned
    FROM public.bookings WHERE id = p_booking_id FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF v_bk_lat IS NULL OR v_bk_lng IS NULL THEN
    RAISE EXCEPTION 'You are outside the service radius for this booking.';
  END IF;

  v_distance := public.haversine_km(v_exp_lat, v_exp_lng, v_bk_lat, v_bk_lng);
  IF v_distance > v_radius THEN
    RAISE EXCEPTION 'You are outside the service radius for this booking.';
  END IF;

  IF v_current_status <> 'accepted' OR v_current_assigned IS NOT NULL THEN
    RAISE EXCEPTION 'This booking has already been accepted by another expert.';
  END IF;

  -- Trigger bookings_before_update requires the bypass value to be
  -- exactly 'on' (not 'true'). The previous 'true' string silently failed
  -- the bypass check, so the trigger rejected the assigned_expert_id/status
  -- change with "Field not updatable".
  PERFORM set_config('app.booking_bypass', 'on', true);
  UPDATE public.bookings
    SET assigned_expert_id = v_expert_id,
        status = 'expert_assigned',
        updated_at = now()
    WHERE id = p_booking_id AND status = 'accepted' AND assigned_expert_id IS NULL
    RETURNING * INTO v_row;
  PERFORM set_config('app.booking_bypass', 'off', true);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This booking has already been accepted by another expert.';
  END IF;

  UPDATE public.experts SET is_busy = true WHERE id = v_expert_id;

  INSERT INTO public.audit_logs (actor_id, actor_role, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'expert', 'claim_booking', 'booking', p_booking_id,
          jsonb_build_object('expert_id', v_expert_id, 'distance_km', v_distance));

  PERFORM public.notify_customer_push(
    p_booking_id,
    'Expert assigned!',
    COALESCE(v_expert_name, 'Your expert') || ' is on the way for your booking.',
    'booking/' || p_booking_id::text
  );

  RETURN v_row;
END;
$function$;