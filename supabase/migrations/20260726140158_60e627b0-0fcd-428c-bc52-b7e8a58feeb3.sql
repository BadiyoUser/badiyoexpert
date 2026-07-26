CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Set / update PIN for the current signed-in expert
CREATE OR REPLACE FUNCTION public.set_login_pin(p_pin text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_pin !~ '^\d{4}$' THEN
    RAISE EXCEPTION 'PIN must be 4 digits';
  END IF;
  UPDATE public.experts
     SET pin_hash = crypt(p_pin, gen_salt('bf'))
   WHERE auth_user_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expert profile not found';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_login_pin(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_login_pin(text) TO authenticated;

-- Public: does a phone have a PIN set?
CREATE OR REPLACE FUNCTION public.has_login_pin(p_phone text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.experts
     WHERE status = 'active'
       AND pin_hash IS NOT NULL
       AND (phone = p_phone OR phone = '+91'||p_phone OR phone = '91'||p_phone)
  );
$$;

REVOKE ALL ON FUNCTION public.has_login_pin(text) FROM public;
GRANT EXECUTE ON FUNCTION public.has_login_pin(text) TO anon, authenticated, service_role;

-- Server-only helper (called by edge fn with service role)
CREATE OR REPLACE FUNCTION public.verify_login_pin_internal(p_phone text, p_pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expert  public.experts%ROWTYPE;
  v_lock    public.pin_login_lockouts%ROWTYPE;
  v_now     timestamptz := now();
  v_max     int := 5;
  v_window  interval := interval '15 minutes';
BEGIN
  SELECT * INTO v_expert FROM public.experts
   WHERE status='active'
     AND (phone=p_phone OR phone='+91'||p_phone OR phone='91'||p_phone)
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_REGISTERED');
  END IF;
  IF v_expert.pin_hash IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_PIN');
  END IF;

  SELECT * INTO v_lock FROM public.pin_login_lockouts WHERE phone=p_phone;
  IF FOUND AND v_lock.locked_until IS NOT NULL AND v_lock.locked_until > v_now THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'LOCKED',
      'retry_after_seconds', EXTRACT(EPOCH FROM (v_lock.locked_until - v_now))::int
    );
  END IF;

  IF crypt(p_pin, v_expert.pin_hash) = v_expert.pin_hash THEN
    DELETE FROM public.pin_login_lockouts WHERE phone=p_phone;
    RETURN jsonb_build_object(
      'ok', true,
      'expert_id', v_expert.id,
      'auth_user_id', v_expert.auth_user_id
    );
  END IF;

  -- wrong pin: bump counter
  INSERT INTO public.pin_login_lockouts(phone, failed_attempts, locked_until, updated_at)
  VALUES (p_phone, 1, NULL, v_now)
  ON CONFLICT (phone) DO UPDATE
     SET failed_attempts = public.pin_login_lockouts.failed_attempts + 1,
         updated_at = v_now,
         locked_until = CASE
           WHEN public.pin_login_lockouts.failed_attempts + 1 >= v_max
             THEN v_now + v_window
           ELSE NULL
         END
  RETURNING * INTO v_lock;

  IF v_lock.locked_until IS NOT NULL AND v_lock.locked_until > v_now THEN
    RETURN jsonb_build_object('ok', false, 'error', 'LOCKED',
      'retry_after_seconds', EXTRACT(EPOCH FROM (v_lock.locked_until - v_now))::int);
  END IF;
  RETURN jsonb_build_object('ok', false, 'error', 'BAD_PIN',
    'attempts_left', v_max - v_lock.failed_attempts);
END;
$$;

REVOKE ALL ON FUNCTION public.verify_login_pin_internal(text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_login_pin_internal(text, text) TO service_role;

-- Ensure lockouts table has phone as PK-ish for upsert
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='pin_login_lockouts_phone_key') THEN
    BEGIN
      ALTER TABLE public.pin_login_lockouts ADD CONSTRAINT pin_login_lockouts_phone_key UNIQUE (phone);
    EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL;
    END;
  END IF;
END $$;