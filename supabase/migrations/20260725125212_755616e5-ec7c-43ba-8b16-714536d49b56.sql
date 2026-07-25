
-- 1) Experts: additive columns
ALTER TABLE public.experts
  ADD COLUMN IF NOT EXISTS is_online boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auth_user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_experts_phone ON public.experts(phone);
CREATE INDEX IF NOT EXISTS idx_experts_auth_user_id ON public.experts(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_assigned_expert_id ON public.bookings(assigned_expert_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON public.bookings(status);

-- 2) Helper: resolve current signed-in user -> expert id
CREATE OR REPLACE FUNCTION public.get_expert_id_for_auth(_auth_uid uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.experts WHERE auth_user_id = _auth_uid LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_expert_id_for_auth(uuid) TO authenticated, service_role;

-- 3) Emergency alerts table
CREATE TABLE IF NOT EXISTS public.emergency_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expert_id uuid NOT NULL REFERENCES public.experts(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  latitude numeric,
  longitude numeric,
  status text NOT NULL DEFAULT 'open',
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  acknowledged_at timestamp with time zone,
  acknowledged_by uuid
);

GRANT SELECT ON public.emergency_alerts TO authenticated;
GRANT ALL ON public.emergency_alerts TO service_role;

ALTER TABLE public.emergency_alerts ENABLE ROW LEVEL SECURITY;

-- Staff can read all alerts (mirrors existing staff-read pattern)
CREATE POLICY "Staff can read emergency_alerts"
  ON public.emergency_alerts
  FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.staff_users s
    WHERE s.auth_user_id = auth.uid() AND s.status = 'active'
  ));

-- Experts can read their own alerts
CREATE POLICY "Experts can read own emergency_alerts"
  ON public.emergency_alerts
  FOR SELECT
  TO authenticated
  USING (expert_id = public.get_expert_id_for_auth(auth.uid()));

-- No client insert/update/delete policies -> only service-role can write.

-- 4) Expert-scoped RLS additions (do not touch existing policies)

-- Experts: self read
DROP POLICY IF EXISTS "Experts can view own record" ON public.experts;
CREATE POLICY "Experts can view own record"
  ON public.experts
  FOR SELECT
  TO authenticated
  USING (auth_user_id = auth.uid());

-- Bookings: assigned expert can view their own bookings
DROP POLICY IF EXISTS "Experts can view assigned bookings" ON public.bookings;
CREATE POLICY "Experts can view assigned bookings"
  ON public.bookings
  FOR SELECT
  TO authenticated
  USING (assigned_expert_id = public.get_expert_id_for_auth(auth.uid()));

-- Addresses: expert can view addresses tied to their assigned bookings
DROP POLICY IF EXISTS "Experts can view addresses for assigned bookings" ON public.addresses;
CREATE POLICY "Experts can view addresses for assigned bookings"
  ON public.addresses
  FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.address_id = addresses.id
      AND b.assigned_expert_id = public.get_expert_id_for_auth(auth.uid())
  ));

-- Users (customer profile): expert can view customer of their assigned booking
DROP POLICY IF EXISTS "Experts can view customer of assigned booking" ON public.users;
CREATE POLICY "Experts can view customer of assigned booking"
  ON public.users
  FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.user_id = users.id
      AND b.assigned_expert_id = public.get_expert_id_for_auth(auth.uid())
  ));
