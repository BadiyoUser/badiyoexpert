
-- Allow online experts to read broadcast-eligible bookings (unassigned + accepted)
DROP POLICY IF EXISTS "Online experts can view broadcast bookings" ON public.bookings;
CREATE POLICY "Online experts can view broadcast bookings"
ON public.bookings
FOR SELECT
TO authenticated
USING (
  assigned_expert_id IS NULL
  AND status = 'accepted'
  AND EXISTS (
    SELECT 1 FROM public.experts e
    WHERE e.auth_user_id = auth.uid()
      AND e.is_online = true
      AND e.status = 'active'
  )
);

-- Ensure bookings table is in the realtime publication (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'bookings'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.bookings';
  END IF;
END $$;

ALTER TABLE public.bookings REPLICA IDENTITY FULL;

-- RPC: expert updates their own current location
CREATE OR REPLACE FUNCTION public.expert_update_location(_lat numeric, _lng numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF _lat IS NULL OR _lng IS NULL THEN
    RAISE EXCEPTION 'Invalid coordinates';
  END IF;
  UPDATE public.experts
  SET current_lat = _lat,
      current_lng = _lng,
      location_updated_at = now()
  WHERE auth_user_id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.expert_update_location(numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expert_update_location(numeric, numeric) TO authenticated;
