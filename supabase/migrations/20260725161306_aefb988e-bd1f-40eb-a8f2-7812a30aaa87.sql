CREATE OR REPLACE FUNCTION public.expert_ensure_booking_codes(_booking_id uuid)
 RETURNS TABLE(start_otp text, end_otp text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _expert_id uuid; _assigned uuid; _status text; _cur_start text; _cur_end text; _s text; _e text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  _expert_id := public.get_expert_id_for_auth(auth.uid());
  IF _expert_id IS NULL THEN RAISE EXCEPTION 'Not an expert'; END IF;

  SELECT b.assigned_expert_id, b.status, b.start_otp, b.end_otp
    INTO _assigned, _status, _cur_start, _cur_end
    FROM public.bookings b WHERE b.id = _booking_id FOR UPDATE;
  IF _assigned IS NULL AND _status IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF _assigned <> _expert_id THEN RAISE EXCEPTION 'Not your booking'; END IF;
  IF _status NOT IN ('expert_assigned','in_progress') THEN
    RAISE EXCEPTION 'Booking not in a code-issuable state';
  END IF;

  _s := COALESCE(_cur_start, public.generate_otp4());
  _e := COALESCE(_cur_end, public.generate_otp4());

  IF _cur_start IS NULL OR _cur_end IS NULL THEN
    PERFORM set_config('app.booking_bypass','on', true);
    UPDATE public.bookings SET start_otp = _s, end_otp = _e WHERE id = _booking_id;
    PERFORM set_config('app.booking_bypass','off', true);
  END IF;

  start_otp := _s;
  end_otp := _e;
  RETURN NEXT;
END $function$;