
CREATE OR REPLACE FUNCTION public.get_broadcast_booking_address(p_booking_id uuid)
RETURNS TABLE (
  full_address text,
  area text,
  city text,
  landmark_photo_url text,
  latitude numeric,
  longitude numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expert_id uuid;
  v_status text;
  v_assigned uuid;
  v_addr uuid;
BEGIN
  v_expert_id := public.get_expert_id_for_auth(auth.uid());
  IF v_expert_id IS NULL THEN RETURN; END IF;

  SELECT b.status, b.assigned_expert_id, b.address_id
    INTO v_status, v_assigned, v_addr
    FROM public.bookings b WHERE b.id = p_booking_id;

  IF v_addr IS NULL THEN RETURN; END IF;
  -- Only expose while the booking is still an open broadcast, or already assigned to this expert
  IF NOT (
    (v_status = 'accepted' AND v_assigned IS NULL)
    OR v_assigned = v_expert_id
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT a.full_address, a.area, a.city, a.landmark_photo_url, a.latitude, a.longitude
    FROM public.addresses a WHERE a.id = v_addr;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_broadcast_booking_address(uuid) TO authenticated;
