
-- Expert wallet ledger read
DROP POLICY IF EXISTS "Experts can view own wallet_ledger" ON public.wallet_ledger;
CREATE POLICY "Experts can view own wallet_ledger"
  ON public.wallet_ledger
  FOR SELECT
  TO authenticated
  USING (owner_type = 'expert' AND owner_id = public.get_expert_id_for_auth(auth.uid()));

-- Toggle online
CREATE OR REPLACE FUNCTION public.expert_set_online(_online boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _expert_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  _expert_id := public.get_expert_id_for_auth(auth.uid());
  IF _expert_id IS NULL THEN RAISE EXCEPTION 'Not an expert'; END IF;
  UPDATE public.experts SET is_online = COALESCE(_online, false) WHERE id = _expert_id;
END $$;
GRANT EXECUTE ON FUNCTION public.expert_set_online(boolean) TO authenticated;

-- Generate/keep booking OTP codes
CREATE OR REPLACE FUNCTION public.expert_ensure_booking_codes(_booking_id uuid)
RETURNS TABLE(start_otp text, end_otp text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _expert_id uuid; _b record; _s text; _e text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  _expert_id := public.get_expert_id_for_auth(auth.uid());
  IF _expert_id IS NULL THEN RAISE EXCEPTION 'Not an expert'; END IF;

  SELECT id, assigned_expert_id, status, start_otp, end_otp
    INTO _b FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF _b.id IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF _b.assigned_expert_id <> _expert_id THEN RAISE EXCEPTION 'Not your booking'; END IF;
  IF _b.status NOT IN ('expert_assigned','in_progress') THEN
    RAISE EXCEPTION 'Booking not in a code-issuable state';
  END IF;

  _s := COALESCE(_b.start_otp, public.generate_otp4());
  _e := COALESCE(_b.end_otp, public.generate_otp4());

  IF _b.start_otp IS NULL OR _b.end_otp IS NULL THEN
    PERFORM set_config('app.booking_bypass','on', true);
    UPDATE public.bookings SET start_otp = _s, end_otp = _e WHERE id = _booking_id;
    PERFORM set_config('app.booking_bypass','off', true);
  END IF;

  RETURN QUERY SELECT _s, _e;
END $$;
GRANT EXECUTE ON FUNCTION public.expert_ensure_booking_codes(uuid) TO authenticated;

-- Reject booking (revert to accepted for reassignment)
CREATE OR REPLACE FUNCTION public.expert_reject_booking(_booking_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _expert_id uuid; _b record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  _expert_id := public.get_expert_id_for_auth(auth.uid());
  IF _expert_id IS NULL THEN RAISE EXCEPTION 'Not an expert'; END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN RAISE EXCEPTION 'Reason required'; END IF;

  SELECT id, assigned_expert_id, status
    INTO _b FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF _b.id IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF _b.assigned_expert_id <> _expert_id THEN RAISE EXCEPTION 'Not your booking'; END IF;
  IF _b.status <> 'expert_assigned' THEN RAISE EXCEPTION 'Booking cannot be rejected now'; END IF;

  PERFORM set_config('app.booking_bypass','on', true);
  UPDATE public.bookings
     SET assigned_expert_id = NULL,
         status = 'accepted',
         cancellation_reason = btrim(_reason)
   WHERE id = _booking_id;
  PERFORM set_config('app.booking_bypass','off', true);

  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (auth.uid(), 'expert_rejected_booking', 'bookings', _booking_id,
    jsonb_build_object('assigned_expert_id', _expert_id, 'status', 'expert_assigned'),
    jsonb_build_object('status', 'accepted', 'reason', btrim(_reason)));
END $$;
GRANT EXECUTE ON FUNCTION public.expert_reject_booking(uuid, text) TO authenticated;

-- Verify start OTP -> in_progress
CREATE OR REPLACE FUNCTION public.expert_verify_start_otp(_booking_id uuid, _otp text)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _expert_id uuid; _b record; _end timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  _expert_id := public.get_expert_id_for_auth(auth.uid());
  IF _expert_id IS NULL THEN RAISE EXCEPTION 'Not an expert'; END IF;
  IF _otp IS NULL OR btrim(_otp) = '' THEN RAISE EXCEPTION 'OTP required'; END IF;

  SELECT id, assigned_expert_id, status, start_otp, service_duration_minutes, service_end_at, end_otp
    INTO _b FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF _b.id IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF _b.assigned_expert_id <> _expert_id THEN RAISE EXCEPTION 'Not your booking'; END IF;
  IF _b.status = 'in_progress' THEN RETURN _b.service_end_at; END IF;
  IF _b.status <> 'expert_assigned' THEN RAISE EXCEPTION 'Booking not ready to start'; END IF;
  IF _b.start_otp IS NULL OR btrim(_otp) <> _b.start_otp THEN RAISE EXCEPTION 'Invalid start OTP'; END IF;

  _end := now() + make_interval(mins => _b.service_duration_minutes);

  PERFORM set_config('app.booking_bypass','on', true);
  UPDATE public.bookings
     SET status = 'in_progress',
         started_at = now(),
         service_end_at = _end,
         end_otp = COALESCE(end_otp, public.generate_otp4())
   WHERE id = _booking_id;
  PERFORM set_config('app.booking_bypass','off', true);

  RETURN _end;
END $$;
GRANT EXECUTE ON FUNCTION public.expert_verify_start_otp(uuid, text) TO authenticated;

-- Verify end OTP -> completed + wallet credit
CREATE OR REPLACE FUNCTION public.expert_verify_end_otp(_booking_id uuid, _otp text)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _expert_id uuid; _b record; _payout numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  _expert_id := public.get_expert_id_for_auth(auth.uid());
  IF _expert_id IS NULL THEN RAISE EXCEPTION 'Not an expert'; END IF;
  IF _otp IS NULL OR btrim(_otp) = '' THEN RAISE EXCEPTION 'OTP required'; END IF;

  SELECT id, assigned_expert_id, status, end_otp, service_duration_minutes
    INTO _b FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF _b.id IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF _b.assigned_expert_id <> _expert_id THEN RAISE EXCEPTION 'Not your booking'; END IF;
  IF _b.status = 'completed' THEN
    SELECT COALESCE(expert_payout,0) INTO _payout FROM public.service_catalogue_config
      WHERE duration_minutes = _b.service_duration_minutes AND is_active = true
      ORDER BY created_at DESC LIMIT 1;
    RETURN COALESCE(_payout, 0);
  END IF;
  IF _b.status <> 'in_progress' THEN RAISE EXCEPTION 'Booking not in progress'; END IF;
  IF _b.end_otp IS NULL OR btrim(_otp) <> _b.end_otp THEN RAISE EXCEPTION 'Invalid end OTP'; END IF;

  SELECT COALESCE(expert_payout,0) INTO _payout FROM public.service_catalogue_config
    WHERE duration_minutes = _b.service_duration_minutes AND is_active = true
    ORDER BY created_at DESC LIMIT 1;
  _payout := COALESCE(_payout, 0);

  PERFORM set_config('app.booking_bypass','on', true);
  UPDATE public.bookings
     SET status = 'completed',
         service_end_at = COALESCE(service_end_at, now()),
         updated_at = now()
   WHERE id = _booking_id;
  PERFORM set_config('app.booking_bypass','off', true);

  IF _payout > 0 THEN
    INSERT INTO public.wallet_ledger(owner_type, owner_id, amount, type, reason, created_by)
    VALUES('expert', _expert_id, _payout, 'credit', 'Booking payout: ' || _booking_id::text, auth.uid());

    UPDATE public.experts
      SET wallet_balance = COALESCE(wallet_balance,0) + _payout
      WHERE id = _expert_id;
  END IF;

  RETURN _payout;
END $$;
GRANT EXECUTE ON FUNCTION public.expert_verify_end_otp(uuid, text) TO authenticated;
